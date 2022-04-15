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
    this.cycles = 0
    this.enabled = false;
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

    this.lengthSequencer = new Sequencer({
      rate: 256,
      steps: [1, 0, 1, 0, 1, 0, 0, 1],
      timers: [
        this.channels[0].lengthCounter,
        this.channels[1].lengthCounter,
      ],
    });

    this.volumeSequencer = new Sequencer({
      rate: 64,
      steps: [0, 0, 1, 0, 0, 0, 1, 0],
      timers: [
        this.channels[0].envelopeCounter,
        this.channels[1].envelopeCounter,
      ]
    });

    /*
    this.sweepSequencer = new Sequencer({
      rate: 128,
      steps: [0, 0, 0, 0, 0, 0, 0, 1],
      timers: [
        //this.channel1.sweepCounter,
      ]
    });
    */
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
    if (! this.enabled) {
      return;
    }

    // Check each channel for trigger events
    for (let channel of this.channels) {
      if (! channel.enabled && ((this.mmu.readByte(channel.r4) & 0x40) !== 0))  {
        channel.trigger();
      }
    }

    while (cycles--) {
      this.cycles++;
      this.channels[0].frequencyTimer.step();
      this.channels[1].frequencyTimer.step();

      if (this.cycles % APU.frameSequencerRate === 0) {
        this.lengthSequencer.step()
        this.volumeSequencer.step()
        //this.sweepSequencer.step()
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
    }
  }
}

window.APU = APU;

// Counter that executes callback when count is zero
class Counter {
  constructor(callback) {
    this.value = 0;
    this.callback = callback;
    this.enabled = true;
  }
  get() {
    return this.value;
  }
  step() {
    if (this.value === 0) {
      return;
    }
    this.value--;
    if (this.value === 0) {
      this.callback(this);
    }
  }
  set(value) {
    this.value = value;
  }
}

function createEnvelopeCounter(channel) {
  let mmu = channel.mmu;
  let counter = new Counter((timer) => {
    let value = mmu.readByte(this.r2);
    let volume = value & 0xf;
    let direction = value & 0x8;
    let period = value & 0x7;

    if (period) {
      volume += direction ? 1 : -1;
    }
    if (volume >= 0 && volume <= 0xf) {
      channel.mmu.writeByte(value | volume);
    }
  });
  return counter;
}

function createLengthCounter(channel) {
  let mmu = channel.mmu;
  let counter = new Counter((counter) => {
    // Disable the channel if bit 6 of NRx4 is set
    if ((mmu.readByte(channel.r4) & 0x40) !== 0) {
      channel.enabled = false;
    }
    // Reset length
    let length = channel.mmu.readByte(channel.r1) & 0xf;
    counter.set(channel.maxLength - length);
  });
  return counter;
}

function createSweepCounter(channel) {
  // TODO: Probably wrong
  let mmu = channel.mmu;

  let counter = new Counter((timer) => {
    let value = mmu.readByte(channel.r1);
    let freq = mmu.readByte(channel.r1);
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
    channel.writeByte(channel.r3, freq);
  });
}

class SquareWaveChannel {
  static dutyCyclePatterns = {
    0: 0b01111111, // 12.5%
    1: 0b00111111, // 25%
    2: 0b00001111, // 50%
    3: 0b00000011, // 75%
  };
  static maxLength = 64;

  constructor(params) {
    // Copy register names, etc for easy lookup
    Object.assign(this, params);

    this.volume = 1;
    this.wavePos = 0;
    this.frequencyTimer = new Counter(this.setFrequency.bind(this));
    this.lengthCounter = createLengthCounter(this);
    this.envelopeCounter = createEnvelopeCounter(this);
    this.setFrequency();
  }

  setFrequency() {
    let lo = this.mmu.readByte(this.r3);
    let hi = this.mmu.readByte(this.r4) & 0x7;
    this.wavePos = ++this.wavePos % 8;
    this.frequencyTimer.set((2048 - uint16(hi, lo)) * 4);
  }

  getAmplitude() {
    let n = this.mmu.readByte(this.r1) >> 6;
    return this.volume * (SquareWaveChannel.dutyCyclePatterns[n] & (1 << (7 - this.wavePos)));
  }

  trigger() {
    this.enabled = true;

    if (this.lengthCounter.get() === 0) {
      this.lengthCounter.set(this.maxLength);
    }

    // Reset envelope counter to period
    let period = this.mmu.readByte(this.r2) & 0x7;
    this.envelopeCounter.set(period);

    // Set channel volume to initial envelope volume, update frequency
    this.volume = this.mmu.readByte(this.r2) & 0xf0;
    this.setFrequency();
  }
}

/*
 * Sequencer used for clocking volume, length and sweep modulations
 * ie "frame sequencer" referenced in gb dev docs
 */
class Sequencer {
  constructor(params) {
    this.rate = params.rate;
    this.steps = params.steps;
    this.timers = params.timers;
    this.cycles = 0;
    this.counter = 0;
  }

  step() {
    if (this.cycles % this.rate !== 0) {
      return;
    }
    this.counter++;

    // When current step set to ON advance the timers
    if (this.steps[this.counter] === 1) {
      for (let timer of this.timers) {
        timer.step();
      }
    }
  }
}
