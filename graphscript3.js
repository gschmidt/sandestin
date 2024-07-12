let currentFrameGenerator = null;
class FrameGenerator {
  constructor(generatorFunc, fps) {
    this.generatorObject = generatorFunc();
    this.timePerFrame = 1.0/fps;
    this.rootNode = null;
    this.nextFrameTime = 0;
    this.lastGeneratorResult = null;
  }

  nextFrame() {
    try {
      if (currentFrameGenerator)
        throw new Error("can't nest rendering");
      currentFrameGenerator = this;

      while (! this.lastGeneratorResult ||
          (! this.lastGeneratorResult.done && this.nextFrameTime >= this.lastGeneratorResult.value.untilTime)) {
        this.lastGeneratorResult = this.generatorObject.next();
        if (! this.lastGeneratorResult.done && ! Object.hasOwn(this.lastGeneratorResult.value, 'untilTime'))
          throw new Error("bad generator return value");
      }
 
      const result = this.rootNode.get();
      this.nextFrameTime += this.timePerFrame;
      return result;
    } finally {
      currentFrameGenerator = null;
    }
  }

  _setRoot(node) {
    this.rootNode = node;
  }
} 

function setRoot(node) {
  if (! currentFrameGenerator)
    throw new Error("this should only be called inside a frame generator");
  currentFrameGenerator._setRoot(node);
}

function now() {
  if (! currentFrameGenerator)
    throw new Error("this should only be called inside a frame generator");
  return currentFrameGenerator.nextFrameTime;
}

function untilTime(time) {
  return { untilTime: time };
}

function Sawtooth(from, to, period, position) {
  return new class Sawtooth {
    constructor() {
      this.from = from;
      this.to = to;
      this.period = period;
      this.position = position || 0;
      this._lastTime = now();
    }

    doubleSpeed() {
      this.period = this.period / 2;
    }

    get() {
      let dt = now() - this._lastTime;
      this._lastTime = now();
      this.position = (this.position + dt / this.period) % 1.0;
      let ret = this.from + this.position * (this.to - this.from);
      return ret;
    }
  }
}

function Negate(value) {
  return new class Negate {
    get() {
      return -value.get();
    }
  }
}
  
function* myScript1() {
  let x = Sawtooth(1, 5, 4);
  setRoot(x);
  yield untilTime(2.2);
  setRoot(Sawtooth(10,20,30));
  yield untilTime(8);
  setRoot(x = Sawtooth(1,5,4));
  yield untilTime(16);
  x.doubleSpeed();
}

function* myScript2() {
  setRoot(Negate(Sawtooth(1, 5, 4)));
}

function* myScript3() {
  let s = Sawtooth(0, 10, 10);
  setRoot(Negate(s));
  yield untilTime(5);
  s.doubleSpeed();
}

let g1 = new FrameGenerator(myScript1, 1);
let g2 = new FrameGenerator(myScript2, 1);
for (let time = 0; time < 20; time += 1) {
  console.log(`${time}: ${g1.nextFrame()}, ${g2.nextFrame()}`);
}

let g3 = new FrameGenerator(myScript3, 1);
for (let time = 0; time < 20; time += 1) {
  console.log(`${time}: ${g3.nextFrame()}`);
}