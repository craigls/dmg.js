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
  static sampleRate = 48000;
  static samplingInterval = Math.floor(Constants.CLOCK_SPEED / APU.sampleRate);
  static frameSequencerRate = 8192;

  constructor(mmu) {
    this.mmu = mmu;
    this.audioContext = new AudioContext();
    this.currentSample = new Array(APU.frameCount);
    this.channels = [];
    this.audioQueue = null;
    this.nextAudioTime = 0
    this.currentFrame = 0;
    this.cycles = 0;
    this.enabled = true;
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
        this.nextAudioTime = this.audioContext.currentTime;
      }
      let sampleData = this.audioQueue.shift();
      let buffer = this.audioContext.createBuffer(1, APU.frameCount, APU.sampleRate);

      buffer.getChannelData(0).set(sampleData);

      let source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
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
        if (this.cycles % (8192 * 2) === 0) {
          this.channels[0].clockLength();
          this.channels[1].clockLength();
        }
        if (this.cycles % (8192 * 8) === 0) {
          this.channels[0].clockVolume();
          this.channels[1].clockVolume();
        }
      }
      // Sum audio from each channel, write to buffer
      if (this.cycles % APU.samplingInterval === 0) {
        let amp = this.channels[0].getAmplitude() + this.channels[1].getAmplitude();
        this.currentSample[this.currentFrame] = amp;

        // Push samples to audio queue when buffer is full
        if (this.currentFrame == APU.frameCount - 1) {
          this.audioQueue.push(this.currentSample);
          this.currentSample = new Array(APU.frameCount);
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

  updateLengthCounter(loc, value) {
    let channel;
    switch (loc) {
      case APU.rNR11:
        channel = this.channels[0];
        break;
      case APU.rNR21:
        channel = this.channels[1];
        break;
      case APU.rNR31:
        channel = this.channels[2];
        break;
      case APU.rNR41:
        channel = this.channels[3];
        break;
    }
    if (channel) {
      channel.lengthCounter = channel.maxLength - (value & 0x3f);
    }
  }

  triggerEvent(loc, value) {
    let channel;
    switch (loc) {
      case APU.rNR14:
        channel = this.channels[0];
        break;
      case APU.rNR24:
        channel = this.channels[1];
        break;
      case APU.rNR34:
        channel = this.channels[2];
        break;
      case APU.rNR44:
        channel = this.channels[3];
        break;
    }
    if (channel) {
      channel.trigger();
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
    this.volumeTimer = 0;
    this.enabled = true;
  }

  getAmplitude() {
    let dutyN = this.mmu.readByte(this.r1) >> 6;
    //let dutyCycle = SquareWaveChannel.dutyCyclePatterns[dutyN] & (1 << (7 - this.wavePos));
    let dutyCycle = SquareWaveChannel.dutyCyclePatterns[dutyN] & (1 << this.wavePos);
    return dutyCycle * this.volume;
  }

  trigger() {
    // If DAC is enabled, update channel status to ON
    //if ((mmu.readByte(APU.rNR52) & 0x80) !== 0) {
    // Set internal status to ON
    this.enabled = true;

    // Set channel status flag to ON
    let stats = this.mmu.readByte(APU.rNR52);
    this.mmu.writeByte(APU.rNR52, stats & (1 << this.channelId));

    // Reset the length counter if expired
    if (this.lengthCounter === 0) {
      this.lengthCounter = this.maxLength;
    }

    // Reset envelope counter to period
    this.volumeTimer = this.mmu.readByte(this.r2) & 0x7;

    // Set channel volume to initial envelope volume and update frequency
    this.volume = this.mmu.readByte(this.r2) & 0xf0;

    let lo = this.mmu.readByte(this.r3);
    let hi = this.mmu.readByte(this.r4) & 0x7;
    this.frequencyTimer = (2048 - uint16(hi, lo)) * 4;
  }

  clockFrequency() {
    this.frequencyTimer--;
    if (this.frequencyTimer === 0) {
      let lo = this.mmu.readByte(this.r3);
      let hi = this.mmu.readByte(this.r4) & 0x7;
      this.wavePos = ++this.wavePos % 8;
      this.frequencyTimer = (2048 - uint16(hi, lo)) * 4;
    }
  }

  clockLength() {
    if (this.mmu.readByte(this.r4) & 0x40 === 0) {
      return;
    }
    else if (this.lengthCounter === 0) {
      return;
    }
    this.lengthCounter--;

    // Set channel status flag to zero (disabled)
    if (this.lengthCounter === 0) {
      let flags = this.mmu.readByte(APU.rNR52);
      this.mmu.writeByte(APU.rNR52, flags & ~(1 << this.channelId));

      // Disable channel
      this.enabled = false;
    }
  }

  clockVolume() {
    if (this.volumeTimer > 0) {
      this.volumeTimer--;
    }
    else {
      return;
    }
    let value = this.mmu.readByte(this.r2);
    let volume = value >> 4;
    let direction = (value & 0x8) >> 3;
    let period = value & 0x7;

    if (period === 0) {
      return;
    }
    else if (this.frequencyTimer === 0) {
      volume = 0;
    }
    volume += direction ? 1 : -1;

    if (volume >= 0 && volume <= 0xf) {
      this.mmu.writeByte(this.r2, value | volume);
    }
    else {
      this.volumeTimer = 0;
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
