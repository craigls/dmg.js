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
  }

  reset() {
    this.cycles = 0;
    this.currentFrame = 0;
    this.audioQueue = [];
    this.nextAudioTime = 0;
    this.channels = [];

    let channel1 = new SquareWaveChannel({
      channelId: 0,
      r0: APU.rNR10,
      r1: APU.rNR11,
      r2: APU.rNR12,
      r3: APU.rNR13,
      r4: APU.rNR14,
      mmu: this.mmu,
    });

    let channel2 = new SquareWaveChannel({
      channelId: 1,
      r1: APU.rNR21,
      r2: APU.rNR22,
      r3: APU.rNR23,
      r4: APU.rNR24,
      mmu: this.mmu,
    });

    this.channels.push(channel1);
    this.channels.push(channel2);
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
      gain.gain.value = 0.00001;
      source.buffer = buffer;
      source.connect(gain);
      source.start(this.nextAudioTime);
      this.nextAudioTime += buffer.duration;
    }
  }

  update(cycles) {
    while (cycles--) {
      this.channels[0].clockFrequency();
      this.channels[1].clockFrequency();

      // Advance frame sequencer
      if (this.cycles % APU.frameSequencerRate === 0) {
        let step = this.cycles / APU.frameSequencerRate % 8;
        // Check if the active step is 1 (ON)
        // clock sequencer for each channel
        if (APU.lengthSequence[step] === 1) {
          this.channels[0].clockLength();
          this.channels[1].clockLength();
        }
        if (APU.envelopeSequence[step] === 1) {
          this.channels[0].clockEnvelope();
          this.channels[1].clockEnvelope();
        }
        /*
        if (APU.sweepSequence[step] === 1) {
          this.channels[0].clockSweep();
          this.channels[1].clockSweep();
        }
        */
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
        //volumeLeft *= ((control >> 4) & 0x7); // SO2
        //volumeRight *= (control & 0x7); // SO1

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

  triggerEvent(loc, value) {
    switch (loc) {
      case APU.rNR14:
        this.channels[0].trigger();
        break;
      case APU.rNR24:
        this.channels[1].trigger();
        break;
      case APU.rNR34:
        //this.channels[2].trigger();
        break;
      case APU.rNR44:
        //this.channels[3].trigger();
        break;
      default:
        throw Error("Invalid trigger event: " + loc);
    }
  }
}

window.APU = APU;

class SquareWaveChannel {
  static dutyCyclePatterns = {
    0: 0b00000001, // 12.5%
    1: 0b10000001, // 25%
    2: 0b10000111, // 50%
    3: 0b01111110, // 75%
  };

  constructor(params) {
    // Copy register names, etc for easy lookup
    Object.assign(this, params);
    this.mmu = params.mmu;
    this.volume = 0;
    this.wavePos = 0;
    this.maxLength = 64;
    this.frequencyTimer = 0;
    this.lengthCounter = 0;
    this.envelopeTimer = 0;
    this.enabled = true;
  }

  getAmplitude() {
    if (this.enabled) {
      let dutyN = this.mmu.readByte(this.r1) >> 6;
      let dutyCycle = SquareWaveChannel.dutyCyclePatterns[dutyN] & (1 << this.wavePos);
      return dutyCycle * this.volume;
    }
    return 0;
  }

  trigger() {
    this.enabled = true;

    // Set channel status flag to ON
    let statuses = this.mmu.readByte(APU.rNR52);
    this.mmu.writeByte(APU.rNR52, statuses | (1 << this.channelId));

    // Reset the length counter if expired
    if (this.lengthCounter === 0) {
      this.lengthCounter = this.maxLength - (this.mmu.readByte(this.r1) & 0x3f);
    }

    // Reset envelope counter to period
    this.envelopeTimer = this.mmu.readByte(this.r2) & 0x7;

    // Set channel volume to initial envelope volume
    // and volume envelope timer to period
    let value = this.mmu.readByte(this.r2);
    this.volume = value & 0xf0;
    this.volumeTimer = value & 0x7;

    // Update frequency timer to period
    let lo = this.mmu.readByte(this.r3);
    let hi = this.mmu.readByte(this.r4) & 0x7;
    this.frequencyTimer = (2048 - uint16(hi, lo)) * 4;

    // If DAC is off then disable channel
    if ((this.mmu.readByte(APU.rNR52) & 0x80) === 0) {
      this.enabled = false;
    }
  }

  clockFrequency() {
    if (this.frequencyTimer === 0) {
      return;
    }
    this.frequencyTimer--;
    if (this.frequencyTimer === 0) {
      let lo = this.mmu.readByte(this.r3);
      let hi = this.mmu.readByte(this.r4) & 0x7;
      this.wavePos = (this.wavePos + 1) % 8;
      this.frequencyTimer = (2048 - uint16(hi, lo)) * 4;
    }
  }

  clockLength() {
    // Length disabled
    if ((this.mmu.readByte(this.r4) & 0x40) === 0) {
      return;
    }
    if (this.lengthCounter === 0) {
      return;
    }
    this.lengthCounter--;

    if (this.lengthCounter > 0) {
        return;
    }
    // Disable channel if length enabled (NRx4 bit 6 is set)
    //if ((this.mmu.readByte(this.r4) & 0x40) !== 0) {
      // Set channel status flag to zero (disabled)
      //let statuses = this.mmu.readByte(APU.rNR52);
      //this.mmu.writeByte(APU.rNR52, statuses & ~(1 << this.channelId));

      // Disable channel
      this.enabled = false;
    //}
  }

  clockEnvelope() {
    let value = this.mmu.readByte(this.r2);
    let volume = value & 0xf0;
    let direction = (value & 0x8) >> 3;
    let period = value & 0x7;

    if (period === 0) {
      return;
    }
    this.envelopeTimer--;

    if (this.envelopeTimer === 0) {
      this.envelopeTimer = period;
      volume += direction ? 1 : -1;

      if (volume >= 0 && volume <= 0xf) {
        this.volume = volume;
      }
    }
  }

  clockSweep() {
    // TODO: Probably wrong
    let value = this.mmu.readByte(this.r1);
    let freq = this.mmu.readByte(this.r1);
    let time = value & 0b1110000;
    let direction = value & 0b1000;
    let shift = value & 0b111;
    // No change
    if (time === 0) {
      return;
    }
    // Frequency increases
    if (direction === 0) {
      freq = freq + freq / 2 ^ shift;
    }
    // Frequency decreases
    else {
      freq = freq - freq / 2 ^ shift;
    }
    this.writeByte(this.r3, freq);
  }
}
