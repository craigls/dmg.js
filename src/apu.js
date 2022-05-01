// APU

class APU {
  // channel 1 (tone and sweep)
  static rNR10 = 0xff10; // sweep register (rw)
  static rNR11 = 0xff11; // sound length/wave pattern duty (rw)
  static rNR12 = 0xff12; // volume env (rw)
  static rNR13 = 0xff13; // freq lo (w)
  static rNR14 = 0xff14; // freq hi (rw)

  // channel 2 (tone)
  static rNR21 = 0xff16; // sound length/wave pattern duty (rw)
  static rNR22 = 0xff17; // volume env (rw)
  static rNR23 = 0xff18; // freq lo data (w)
  static rNR24 = 0xff19; // freq hi data (w)

  // channel 3 (wave)
  // wave pattern ram is at ff30-ff3f
  static rNR30 = 0xff1a; // sound on/off (rw)
  static rNR31 = 0xff1b; // sound length (w)
  static rNR32 = 0xff1c; // select output level (rw)
  static rNR33 = 0xff1d; // freq lo data (rw)
  static rNR34 = 0xff1e; // freq hi data (rw)

  // channel 4 (noise)
  static rNR41 = 0xff20; // sound length (w)
  static rNR42 = 0xff21; // volume env (rw)
  static rNR43 = 0xff22; // polynomial counter (rw)
  static rNR44 = 0xff23; // counter/consecutive; initial (rw)

  // sound control registers
  static rNR50 = 0xff24; // channel control / on-off / volume (r/w)
  static rNR51 = 0xff25; // sound output terminal (rw)
  static rNR52 = 0xff26; // sound on/off

  static frameCount = 1024;
  static frameSequencerRate = 8192;
  static lengthSequence =   [1, 0, 1, 0, 1, 0, 1, 0];
  static envelopeSequence = [0, 0, 0, 0, 0, 0, 0, 1];
  static sweepSequence =    [0, 0, 1, 0, 0, 0, 1, 0];

  constructor(mmu) {
    this.mmu = mmu;
    this.audioContext = new AudioContext();
    this.sampleLeft = new Array(APU.frameCount);
    this.sampleRight = new Array(APU.frameCount);
    this.channels = [];
    this.audioQueue = null;
    this.nextAudioTime = 0
    this.currentFrame = 0;
    this.cycles = 0;
    this.sampleRate = this.audioContext.sampleRate;
    this.samplingInterval = Math.floor(Constants.CLOCK_SPEED / this.sampleRate);
    this.enabled = false;

    this.square1 = new SquareChannel({
      channelId: 0,
      r0: APU.rNR10,
      r1: APU.rNR11,
      r2: APU.rNR12,
      r3: APU.rNR13,
      r4: APU.rNR14,
      mmu: this.mmu,
    });

    this.square2 = new SquareChannel({
      channelId: 1,
      r1: APU.rNR21,
      r2: APU.rNR22,
      r3: APU.rNR23,
      r4: APU.rNR24,
      mmu: this.mmu,
    });

    this.wave = new WaveChannel({
      channelId: 2,
      r1: APU.rNR31,
      r2: APU.rNR32,
      r3: APU.rNR33,
      r4: APU.rNR34,
      mmu: this.mmu,
    });

    this.noise = new NoiseChannel({
      channelId: 3,
      r1: APU.rNR41,
      r2: APU.rNR42,
      r3: APU.rNR43,
      r4: APU.rNR44,
    });

    this.channels.push(this.square1);
    this.channels.push(this.square2);
    this.channels.push(this.wave);
  }

  reset() {
    this.cycles = 0;
    this.currentFrame = 0;
    this.audioQueue = [];
    this.nextAudioTime = 0;
    this.enabled = false;
  }

  processAudioQueue() {
    // Schedule audio playback until the queue is empty
    // This might be totally wrong
    while (this.audioQueue.length) {
      // HACK: Sample playback is lagging behind so fast-forward
      if (this.audioContext.currentTime > this.nextAudioTime) {
        console.log("audio lag!");
        this.nextAudioTime = this.audioContext.currentTime;
      }
      let buffer = this.audioContext.createBuffer(2, APU.frameCount, this.sampleRate);
      buffer.getChannelData(0).set(this.audioQueue.shift());
      buffer.getChannelData(1).set(this.audioQueue.shift());

      let source = this.audioContext.createBufferSource();
      let gain = this.audioContext.createGain();
      gain.connect(this.audioContext.destination);
      gain.gain.value = 0.0001;
      source.buffer = buffer;
      source.connect(gain);
      source.start(this.nextAudioTime);
      this.nextAudioTime += buffer.duration;
    }
  }

  update(cycles) {
    while (cycles--) {
      this.square1.clockFrequency();
      this.square2.clockFrequency();
      this.wave.clockFrequency();

      // Advance frame sequencer
      if (this.cycles % APU.frameSequencerRate === 0) {
        let step = this.cycles / APU.frameSequencerRate % 8;
        // Check if the active step is 1 (ON)
        // clock sequencer for each channel
        if (APU.lengthSequence[step] === 1) {
          this.square1.clockLength();
          this.square2.clockLength();
          this.wave.clockLength();
        }
        if (APU.envelopeSequence[step] === 1) {
          this.square1.clockEnvelope();
          this.square2.clockEnvelope();
          this.wave.clockEnvelope();
        }
        if (APU.sweepSequence[step] === 1) {
          this.square1.clockSweep();
        }
      }
      // Sum audio from each channel, write to buffer
      if (this.cycles % this.samplingInterval === 0) {
        let volumeLeft = 0;
        let volumeRight = 0;
        // Get values of volume control, panning and channel status registers
        let control = this.mmu.readByte(APU.rNR50);
        let panning = this.mmu.readByte(APU.rNR51);
        let statuses = this.mmu.readByte(APU.rNR52);

        // bit 7 set indicates audio is disabled
        if ((statuses & 0x80) !== 0) {

          // Loop through each channel, calculate amplitude, apply panning
          for (let channel of this.channels) {
            let amplitude = channel.getAmplitude();

            // Left channel
            if ((panning & (1 << (channel.channelId + 4))) !== 0) {
              volumeLeft += amplitude;
            }
            // Right channel
            if ((panning & (1 << channel.channelId)) !== 0) {
              volumeRight += amplitude;
            }
          }
        }
        // Apply master volume settings.
        // +1 is added to volume so channels aren't muted
        volumeLeft *= ((control >> 4) & 0x7) + 1; // SO2
        volumeRight *= (control & 0x7) + 1; // SO1

        this.sampleLeft[this.currentFrame] = volumeLeft / 2;
        this.sampleRight[this.currentFrame] = volumeRight / 2;

        // Push samples to audio queue when buffer is full
        if (this.currentFrame == APU.frameCount - 1) {
          this.audioQueue.push(this.sampleLeft);
          this.audioQueue.push(this.sampleRight);
          this.sampleLeft = new Array(APU.frameCount);
          this.sampleRight = new Array(APU.frameCount);
          this.currentFrame = 0;
        }
        else {
          this.currentFrame++;
        }
      }
      this.processAudioQueue();
      this.cycles++;
    }
  }

  writeRegister(loc, value) {

    // Route NRxx writes to correct channel
    switch (loc) {
      case APU.rNR11:
      case APU.rNR12:
      case APU.rNR14:
        this.square1.writeRegister(loc, value);
        break;

      case APU.rNR21:
      case APU.rNR22:
      case APU.rNR24:
        this.square2.writeRegister(loc, value);
        break;

      case APU.rNR30:
      case APU.rNR31:
      case APU.rNR32:
      case APU.rNR33:
      case APU.rNR34:
        this.wave.writeRegister(loc, value);
        break;

      case APU.rNR44:
        break;

      default:
        // Do nothing
        break;
    }
    return value;
  }
}

window.APU = APU;

// Base Channel (messy)
class BaseChannel {

  constructor(params) {
    // Copy register names, etc for easy lookup
    Object.assign(this, params);
    this.mmu = params.mmu;
    this.volume = 0;
    this.frequency = 0;
    this.frequencyTimer = 0;
    this.lengthCounter = 0;
    this.lengthEnabled = false;
    this.envelopeTimer = 0;
    this.enabled = false;
  }

  writeRegister(loc, value) {
    // Update length counter
    if (loc === this.r1) {
      this.lengthCounter = this.maxLength - (value & 0x3f);
    }
    // Recieved DAC disable
    else if (loc === this.r2 && (value & 0xf8) == 0) {
      this.enabled = false;
      let statuses = this.mmu.readByte(APU.rNR52);
      this.mmu.writeByte(APU.rNR52, statuses & ~(1 << this.channelId));
    }
    else if (loc == this.r4) {
      // Update length enabled status
      this.lengthEnabled = (value & 0x40) !== 0;

      // Trigger channel
      if (value & 0x80) {
        this.trigger();
      }
    }
    return value;
  }

  getAmplitude() {
    // Important stuff goes here
    throw new Error("Not Implemented");
  }

  update() {
    // Advance waveform generation here
    throw new Error("Not Implemented");
  }

  trigger() {
    this.enabled = true;

    // Set channel status flag to ON
    let statuses = this.mmu.readByte(APU.rNR52);
    this.mmu.writeByte(APU.rNR52, statuses | (1 << this.channelId));

    // Set length enabled flag
    // Reset the length counter if expired
    if (this.lengthCounter === 0) {
      this.lengthCounter = this.maxLength;
    }

    // Set channel volume to initial envelope volume
    // and volume envelope timer to period
    let value = this.mmu.readByte(this.r2);
    this.volume = value >> 4;
    this.envelopeTimer = value & 0x7;

    // Reload frequency timer
    this.updateFrequency();

    // Update sweep (channel 0 only)
    if (this.channelId === 0) {
      let value = this.mmu.readByte(this.r0);
      let period = (value & 0x70) >> 4;
      let shift = value & 0x7;
      this.sweepTimer = period || 8; // set to 8 if period is zero (why?)
      this.shadowFrequency = this.frequency;

      if (period !== 0 || shift !== 0) {
        this.sweepEnabled = true;
      }
      else {
        this.sweepEnabled = false;
      }
      if (shift !== 0) {
        this.calcSweepFrequency();
      }
    }

    // If DAC is off then disable channel
    if ((this.mmu.readByte(APU.rNR52) & 0x80) === 0) {
      this.enabled = false;
    }
  }

  clockFrequency() {
    this.frequencyTimer--;

    if (this.frequencyTimer === 0) {
      this.update();
    }
  }

  clockLength() {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;

      if (this.lengthCounter === 0) {
        // Set channel status flag to zero (disabled)
        let statuses = this.mmu.readByte(APU.rNR52);
        this.mmu.writeByte(APU.rNR52, statuses & ~(1 << this.channelId));

        // Disable channel
        this.enabled = false;
        this.reset();
      }
    }
  }

  clockEnvelope() {
    let value = this.mmu.readByte(this.r2);
    let increase = (value & 0x8) !== 0;
    let period = value & 0x7;

    this.envelopeTimer--;

    if (this.envelopeTimer === 0) {
      if (period > 0) {
        this.envelopeTimer = period;
        let adjustment = increase ? 1 : -1;
        let newVolume = this.volume + adjustment;

        if (newVolume >= 0 && newVolume <= 0xf) {
          this.volume = newVolume;
        }
      }
    }
  }

  clockSweep() {
    if (this.sweepEnabled && this.sweepTimer > 0) {
      this.sweepTimer--;

      if (this.sweepTimer === 0) {
        let value = this.mmu.readByte(this.r0);
        let shift = value & 0x7;
        let period = (value & 0x70) >> 4;

        if (period !== 0) {

          let newFrequency = this.calcSweepFrequency();

          // Update shadow register, write new frequency to NR13/14
          // Then run frequency calculation again but don't write it back (??)
          if (newFrequency <= 2047 && shift !== 0) {
            this.shadowFrequency = newFrequency;

            let msb = newFrequency >> 8 & 0x7;
            let lsb = newFrequency & 0xff;

            this.mmu.writeByte(this.r3, lsb);
            this.mmu.writeByte(this.r4, this.mmu.readByte(this.r4) & ~0x7 | msb);

            this.calcSweepFrequency();
          }
          // Reload timer
          this.sweepTimer = period || 8; // set to 8 if period is zero (why?)
        }
      }
    }
  }

  calcSweepFrequency() {
    let value = this.mmu.readByte(this.r0);
    let negate = (value & 0x8) !== 0;
    let shift = value & 0x7;
    let newFrequency = this.shadowFrequency >> shift;
    if (negate) {
      newFrequency = this.shadowFrequency - newFrequency;
    }
    else {
      newFrequency = this.shadowFrequency + newFrequency;
    }
    // If overflow disable square 1 channel
    if (newFrequency > 2047) {
      let statuses = this.mmu.readByte(APU.rNR52);
      this.mmu.writeByte(APU.rNR52, statuses & ~(1 << this.channelId));
      this.enabled = false;
    }
    return newFrequency;
  }
}


class SquareChannel extends BaseChannel{
  static dutyCyclePatterns = {
    0: 0b00000001, // 12.5%
    1: 0b10000001, // 25%
    2: 0b10000111, // 50%
    3: 0b01111110, // 75%
  };

  constructor(params) {
    super(params);
    this.position = 0;
    this.maxLength = 64;
    this.sweepTimer = 0;
    this.shadowFrequency = 0;
    this.sweepEnabled = false;
  }

  getAmplitude() {
    let dutyN = this.mmu.readByte(this.r1) >> 6;
    let dutyCycle = SquareChannel.dutyCyclePatterns[dutyN] & (1 << this.position);
    return dutyCycle * (this.enabled ? this.volume : 0);
  }

  update() {
    this.position = ++this.position % 8;
    this.updateFrequency();
  }

  updateFrequency() {
    this.frequency = uint16(
      this.mmu.readByte(this.r4) & 0x7,
      this.mmu.readByte(this.r3)
    );
    this.frequencyTimer = (2048 - this.frequency) * 4;
  }

  reset() {
    this.position = 0;
  }
}

class WaveChannel extends BaseChannel{
  static baseAddress = 0xff30; // wavetable is at 0xff30 to 0xff3f
  static volumeShiftRight = {
    0: 4,
    1: 0,
    2: 1,
    3: 2,
  }

  constructor(params) {
    super(params);
    this.position = 0;
    this.sample = null;
    this.maxLength = 256;
  }

  update() {
    this.updatePosition();
    this.updateFrequency();
  }

  getAmplitude() {
    let shift = WaveChannel.volumeShiftRight[this.mmu.readByte(this.r2) >> 5];
    let address = WaveChannel.baseAddress + Math.floor(this.position / 2);
    let sample = 0;

    if (this.position % 2 === 0) {
      sample = this.mmu.readByte(address) & 0x0f;
    }
    else {
      sample = this.mmu.readByte(address) >> 4;
    }
    return (sample >> shift) * (this.enabled ? this.volume : 0);
  }

  updatePosition() {
    this.position = ++this.position % 64;
  }

  updateFrequency() {
    this.frequency = uint16(
      this.mmu.readByte(this.r4) & 0x7,
      this.mmu.readByte(this.r3)
    );
    this.frequencyTimer = (2048 - this.frequency) * 2;
  }

  reset() {
    this.position = 0;
  }

  dacEnabled() {
    return ((this.mmu.readByte(APU.rNR52) & 0x80) === 0);
  }
}

class NoiseChannel {}
