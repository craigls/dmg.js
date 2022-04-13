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
      mmu: this.mmu,
      rWaveDuty: APU.rNR11,
      rLength: APU.rNR11,
      rEnvelope: APU.rNR12,
      rFreqLo: APU.rNR13,
      rFreqHi: APU.rNR14,
      rLengthEnable: APU.rNR14,
    });

    let channel2 = new SquareWaveChannel({
      channelId: 1,
      mmu: this.mmu,
      rWaveDuty: APU.rNR21,
      rLength: APU.rNR21,
      rEnvelope: APU.rNR22,
      rFreqLo: APU.rNR23,
      rFreqHi: APU.rNR24,
      rLengthEnable: APU.rNR24,
    });

    this.channels.push(channel1);
    this.channels.push(channel2);

    this.lengthSequencer = new Sequencer({
      rate: 256,
      steps: [1, 0, 1, 0, 1, 0, 0, 1],
      timers: [
        this.channels[0].lengthTimer,
        this.channels[1].lengthTimer,
      ],
    });

    this.volumeSequencer = new Sequencer({
      rate: 64,
      steps: [0, 0, 1, 0, 0, 0, 1, 0],
      timers: [
        this.channels[0].envelopeTimer,
        this.channels[1].envelopeTimer,
      ]
    });

    this.sweepSequencer = new Sequencer({
      rate: 128,
      steps: [0, 0, 0, 0, 0, 0, 0, 1],
      timers: [
        //this.channel1.sweepTimer,
      ]
    });
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

    while (cycles--) {
      this.cycles++;
      this.channels[0].frequencyTimer.step();
      this.channels[1].frequencyTimer.step();

      if (this.cycles % APU.frameSequencerRate === 0) {
        this.lengthSequencer.step()
        this.volumeSequencer.step()
        this.sweepSequencer.step()
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

// Timer that executes callback when count reaches zero
class Timer {
  constructor(callback) {
    this.value = 0;
    this.callback = callback;
    this.enabled = true;
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

function createEnvelopeTimer(params) {
  // TODO: Probably wrong
  let rVolume = params;
  let mmu = params.mmu;
  let timer = new Timer((timer) => {
    let value = mmu.readByte(rVolume);
    let volume = value & 0b11110000;
    let direction = value & 0b1000;
    let period = value & 0b111;

    if (period) {
      volume += direction ? 1 : -1;
    }
    mmu.writeByte(rVolume, value | volume);
  });

  return timer;
}

function createLengthTimer(params) {
  // TODO: Probably wrong
  let channelId = params.channelId;
  let rLength = params.rLength;
  let maxLength = params.maxLength;
  let mmu = params.mmu;

  let timer = new Timer((timer) => {
    let channels = mmu.readByte(APU.rNR52);
    mmu.writeByte(APU.rNR52, channels | (1 << params.channelId));
    timer.set(maxLength - mmu.readByte(rLength));
  });
  return timer;
}

function createSweepTimer(params) {
  // TODO: Probably wrong
  let rSweep = params.rSweep;
  let rFreq = params.rFreq;
  let mmu = params.mmu;

  let timer = new Timer((timer) => {
    let value = mmu.readByte(rSweep);
    let freq = mmu.readByte(rFreq);
    let time = value & 0b1110000;
    let dir = value & 0b1000;
    let shift = value & 0b111;
    // No change
    if (time === 0) {
      return;
    }
    // Frequency increases
    if (dir === 0) {
      freq = freq + freq / 2 ^ shift;
    }
    // Frequency decreases
    else {
      freq = freq - freq / 2 ^ shift;
    }
    this.writeByte(rFreq, freq);
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

    this.wavePos = 0;
    this.frequencyTimer = new Timer(this.setFrequency.bind(this));

    this.lengthTimer = createLengthTimer({
      channelId: this.channelId,
      mmu: this.mmu,
      rLength: this.rLength
    });

    //this.envelopeTimer = createEnvelopeTimer(this, this.mmu);
    //this.lengthTimer = createLengthTimer(this, this.mmu);
  }

  setFrequency() {
    let lo = this.mmu.readByte(this.rFreqLo);
    let hi = this.mmu.readByte(this.rFreqHi) & 0b111;
    this.wavePos = ++this.wavePos % 8;
    this.frequencyTimer.set((2048 - uint16(hi, lo)) * 4);
  }

  getAmplitude() {
    let n = this.mmu.readByte(this.rWaveDuty) >> 6;
    return SquareWaveChannel.dutyCyclePatterns[n] & (1 << (7 - this.wavePos));
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
      for (let timer in this.timers) {
        timer.step();
      }
    }
  }
}


