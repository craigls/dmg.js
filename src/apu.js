// APU
class APU {
  // Channel 1 (tone and sweep)
  static rNR10 = 0xff10; // Sweep period, negate, shift
  static rNR11 = 0xff11; // Duty, Length load (64-L)
  static rNR12 = 0xff12; // Starting volume, Envelope add mode, period
  static rNR13 = 0xff13; // Frequency LSB
  static rNR14 = 0xff14; // Trigger, Length enable, Frequency MSB

  // Channel 2 (tone)
  static rNR21 = 0xff16; // Duty, Length load (64-L)
  static rNR22 = 0xff17; // Starting volume, Envelope add mode, period
  static rNR23 = 0xff18; // Frequency LSB
  static rNR24 = 0xff19; // Trigger, Length enable, Frequency MSB

  // Channel 3 (wave)
  // wave pattern ram is at ff30-ff3f
  static rNR30 = 0xff1a; // DAC power
  static rNR31 = 0xff1b; // Length load (256-L)
  static rNR32 = 0xff1c; // Volume code (00=0%, 01=100%, 10=50%, 11=25%)
  static rNR33 = 0xff1d; // Frequency LSB
  static rNR34 = 0xff1e; // Trigger, Length enable, Frequency MSB

  // Channel 4 (noise)
  static rNR41 = 0xff20; // Length load (64-L)
  static rNR42 = 0xff21; // Starting volume, Envelope add mode, period
  static rNR43 = 0xff22; // Clock shift, Width mode of LFSR, Divisor code
  static rNR44 = 0xff23; // Trigger, Length enable

  // Sound control registers
  static rNR50 = 0xff24; // Vin L enable, Left vol, Vin R enable, Right vol
  static rNR51 = 0xff25; // Left enables, Right enables
  static rNR52 = 0xff26; // Power control/status, Channel length statuses

  static frameCount = 1024;
  static frameSequencerRate = 8192;
  static lengthSequence =   [1, 0, 1, 0, 1, 0, 1, 0];
  static envelopeSequence = [0, 0, 0, 0, 0, 0, 0, 1];
  static sweepSequence =    [0, 0, 1, 0, 0, 0, 1, 0];
  static defaultGainAmount = 0.01;

  constructor(mmu) {
    this.mmu = mmu;
    this.audioContext = new AudioContext();
    this.sampleLeft = new Array(APU.frameCount);
    this.sampleRight = new Array(APU.frameCount);
    this.audioQueue = null;
    this.nextAudioTime = 0
    this.currentFrame = 0;
    this.cycles = 0;
    this.sampleRate = this.audioContext.sampleRate;
    this.samplingInterval = Math.floor(Constants.CLOCK_SPEED / this.sampleRate);
    this.enabled = false;

    this.square1 = new Square({
      channelId: 0,
      r0: APU.rNR10,
      r1: APU.rNR11,
      r2: APU.rNR12,
      r3: APU.rNR13,
      r4: APU.rNR14,
      rDAC: APU.rNR12,
      rDACmask: 0xf8,
      maxLength: 64,
      mmu: this.mmu,
    });

    this.square2 = new Square({
      channelId: 1,
      r1: APU.rNR21,
      r2: APU.rNR22,
      r3: APU.rNR23,
      r4: APU.rNR24,
      rDAC: APU.rNR12,
      rDACmask: 0xf8,
      maxLength: 64,
      mmu: this.mmu,
    });

    this.wave = new Wavetable({
      channelId: 2,
      r1: APU.rNR31,
      r2: APU.rNR32,
      r3: APU.rNR33,
      r4: APU.rNR34,
      rDAC: APU.rNR30,
      rDACmask: 0x80,
      maxLength: 256,
      mmu: this.mmu,
    });

    this.noise = new Noise({
      channelId: 3,
      r1: APU.rNR41,
      r2: APU.rNR42,
      r3: APU.rNR43,
      r4: APU.rNR44,
      rDAC: APU.rNR42,
      rDACmask: 0xf8,
      maxLength: 64,
      mmu: this.mmu,
    });

    this.channels = [
      this.square1,
      this.square2,
      this.wave,
      this.noise,
    ];
  }

  reset() {
    this.cycles = 0;
    this.currentFrame = 0;
    this.audioQueue = [];
    this.nextAudioTime = 0;
    this.enabled = false;
    this.volumeLeft = 0;
    this.volumeRight = 0;
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
      gain.gain.value = APU.defaultGainAmount;
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
      this.noise.clockFrequency();

      // Advance frame sequencer
      if (this.cycles % APU.frameSequencerRate === 0) {
        let step = this.cycles / APU.frameSequencerRate % 8;
        // Check if the active step is 1 (ON)
        // clock sequencer for each channel
        if (APU.lengthSequence[step] === 1) {
          this.square1.clockLength();
          this.square2.clockLength();
          this.wave.clockLength();
          this.noise.clockLength();
        }
        if (APU.envelopeSequence[step] === 1) {
          this.square1.clockEnvelope();
          this.square2.clockEnvelope();
          this.noise.clockEnvelope();
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
        let statuses = this.mmu.readByte(APU.rNR52);
        let panning = this.mmu.readByte(APU.rNR51);

        // bit 7 set indicates audio is disabled
        if ((statuses & 0x80) !== 0) {
          // Apply panning and channel volumes
          for (let channel of this.channels) {
            let amplitude = channel.enabled ? channel.getAmplitude() : 0;

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

        this.sampleLeft[this.currentFrame] = volumeLeft / 4;
        this.sampleRight[this.currentFrame] = volumeRight / 4;

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

  writeByte(loc, value) {
    // Write new value to register first to avoid race conditions
    this.mmu.writeByte(loc, value);

    // Route NRxx writes to correct channel
    switch (loc) {
      case APU.rNR11:
      case APU.rNR12:
      case APU.rNR13:
      case APU.rNR14:
        this.channelWrite(this.square1, loc, value);
        break;

      case APU.rNR21:
      case APU.rNR22:
      case APU.rNR23:
      case APU.rNR24:
        this.channelWrite(this.square2, loc, value);
        break;

      case APU.rNR30:
      case APU.rNR31:
      case APU.rNR32:
      case APU.rNR33:
      case APU.rNR34:
        this.channelWrite(this.wave, loc, value);
        break;

      case APU.rNR41:
      case APU.rNR42:
      case APU.rNR43:
      case APU.rNR44:
        this.channelWrite(this.noise, loc, value);
        break;

      default:
        // Do nothing
        break;
    }
    return value;
  }

  // Handle writes to channel register
  channelWrite(channel, loc, value) {
    // Update length counter
    if (loc === channel.r1) {
      channel.lengthCounter = channel.maxLength - (value & (channel.maxLength - 1));
    }
    // Recieved DAC disable
    else if (loc === channel.rDAC && (value & channel.rDACmask) == 0) {
      channel.disable();
    }
    else if (loc == channel.r4) {
      // Update length enabled status
      channel.lengthEnabled = (value & 0x40) !== 0;

      // Trigger channel
      if (value & 0x80) {
        // Trigger channel
        this.channelTrigger(channel);

        // If DAC is off then disable channel immediately
        if ((this.mmu.readByte(APU.rNR52) & 0x80) === 0) {
          channel.disable();
        }
      }
    }
  }

  // Channel trigger event via write to (r4) bit 7
  channelTrigger(channel) {
    if (channel.lengthCounter === 0) {
      channel.lengthCounter = channel.maxLength;
    }
    channel.enabled = true;

    // Set channel volume to initial envelope volume
    // and volume envelope timer to period
    let value = this.mmu.readByte(channel.r2);
    channel.volume = value >> 4;
    channel.envelopeTimer = value & 0x7;
    channel.reset();

    // Update sweep (channel 0 only)
    if (channel.channelId === 0) {
      let value = this.mmu.readByte(channel.r0);
      let period = (value & 0x70) >> 4;
      let shift = value & 0x7;
      channel.sweepTimer = period || 8; // set to 8 if period is zero (why?)
      channel.shadowFrequency = channel.frequency;

      if (period !== 0 || shift !== 0) {
        channel.sweepEnabled = true;
      }
      else {
        channel.sweepEnabled = false;
      }
      if (shift !== 0) {
        channel.calcSweepFrequency();
      }
    }

    // Set channel status flag to ON
    let statuses = this.mmu.readByte(APU.rNR52);
    this.mmu.writeByte(APU.rNR52, statuses | (1 << channel.channelId));

  }

}

window.APU = APU;

class Channel {

  // Frequency timer
  clockFrequency() {
    this.frequencyTimer--;

    if (this.frequencyTimer === 0) {
      this.update();
      this.resetTimer();
    }
  }

  // Length timer
  clockLength() {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;

      if (this.lengthCounter === 0) {
        // Disable channel
        this.disable()
      }
    }
  }

  // Volume envelope timer
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

  // Sweep timer (Square 1 only)
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
      this.disable();
    }
    return newFrequency;
  }

  // WRite to channel status register, disable channel
  disable() {
    let statuses = this.mmu.readByte(APU.rNR52);
    this.mmu.writeByte(APU.rNR52, statuses & ~(1 << this.channelId));
    this.enabled = false;
  }

}

class Square extends Channel {
  static dutyCyclePatterns = {
    0: 0b00000001, // 12.5%
    1: 0b10000001, // 25%
    2: 0b10000111, // 50%
    3: 0b01111110, // 75%
  };

  constructor(params) {
    super(params);
    Object.assign(this, params);
    this.volume = 0;
    this.frequency = 0;
    this.frequencyTimer = 0;
    this.lengthCounter = 0;
    this.lengthEnabled = false;
    this.envelopeTimer = 0;
    this.enabled = false;
    this.position = 0;
  }

  getAmplitude() {
    let n = this.mmu.readByte(this.r1) >> 6;
    return this.volume * ((Square.dutyCyclePatterns[n] & (1 << this.position)) & 1);
  }

  update() {
    this.position = ++this.position % 8;
  }

  resetTimer() {
    this.frequency = uint16(
      this.mmu.readByte(this.r4) & 0x7,
      this.mmu.readByte(this.r3)
    );
    this.frequencyTimer = (2048 - this.frequency) * 4;
  }

  reset() {
    this.resetTimer();
    this.position = 0;

    // Reset duty cycle
    this.mmu.writeByte(this.r1, this.mmu.readByte(this.r1) & ~0xff);
  }
}

window.Square = Square;

// Wave channel
class Wavetable extends Channel {

  // Wavetable is at 0xff30 to 0xff3f
  // Each wave uses 4 bits of memory
  static baseAddress = 0xff30;
  static volumeShiftRight = {
    0: 4,
    1: 0,
    2: 1,
    3: 2,
  }

  constructor(params) {
    super(params);
    Object.assign(this, params);
    this.volume = 0; // not used
    this.frequency = 0;
    this.frequencyTimer = 0;
    this.lengthCounter = 0;
    this.lengthEnabled = false;
    this.envelopeTimer = 0;
    this.enabled = false;
    this.position = 0;
    this.sample = null;
  }

  update() {
    this.position = ++this.position % 32;
  }

  getAmplitude() {
    let shift = Wavetable.volumeShiftRight[this.mmu.readByte(this.r2) >> 5];
    let address = Wavetable.baseAddress + Math.floor(this.position / 2);
    let sample = 0;

    if (this.position % 2 === 0) {
      sample = this.mmu.readByte(address) >> 4;
    }
    else {
      sample = this.mmu.readByte(address) & 0x0f;
    }
    return sample >> shift;
  }

  resetTimer() {
    this.frequency = uint16(
      this.mmu.readByte(this.r4) & 0x7,
      this.mmu.readByte(this.r3)
    );
    this.frequencyTimer = (2048 - this.frequency) * 2;
  }

  reset() {
    this.resetTimer();
    this.position = 0;
  }

  // Frequency timer
  clockFrequency() {
    this.frequencyTimer--;

    if (this.frequencyTimer === 0) {
      this.update();
      this.resetTimer();
    }
  }
}

window.Wavetable = Wavetable;

class Noise extends Channel {
  static divisorCodes = {
    0: 8,
    1: 16,
    2: 32,
    3: 48,
    4: 64,
    5: 80,
    6: 96,
    7: 112,
  };

  constructor(params) {
    super(params);
    Object.assign(this, params);
    this.volume = 0;
    this.frequency = 0;
    this.frequencyTimer = 0;
    this.lengthCounter = 0;
    this.lengthEnabled = false;
    this.envelopeTimer = 0;
    this.enabled = false;
    this.sample = null;
    this.LFSR = 32767; // 15-bit linear feedback shift register
  }

  update() {
    let value = this.mmu.readByte(this.r3);
    let width = (value & 0x8) !== 0;

    // XOR lower two bits together
    let bb = (this.LFSR & 1) ^ ((this.LFSR & 2) >> 1);

    // shift LFSR right by one, add XOR result to high bit
    this.LFSR = (bb << 14) | (this.LFSR >> 1);

    // if width mode, add XOR result to bit 6
    if (width) {
      this.LFSR = this.LFSR & ~(1 << 6);
      this.LFSR = this.LFSR | (bb << 6);
      this.LFSR = this.LFSR & 0x7f;
    }
  }

  resetTimer() {
    let value = this.mmu.readByte(this.r3);
    let shift = value >> 4;
    let divisor = Noise.divisorCodes[value & 0x7];
    this.frequencyTimer = divisor << shift;
  }

  getAmplitude() {
    return this.volume * (~this.LFSR & 1);
  }

  reset() {
    this.resetTimer();
    this.LFSR = 32767;
  }
}
window.Noise = Noise;
