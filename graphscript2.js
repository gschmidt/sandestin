let currentFrameGenerator = null;
class FrameGenerator {
  constructor(generatorFunc, fps) {
    this.generatorObject = generatorFunc();
    console.log(this.generatorObject);
    this.timePerFrame = 1.0/fps;
    this.rootNode = null;
    this.nextFrameTime = 0;
    this.done = false;
  }

  nextFrame() {
    if (this.done)
      return null;

    let ret;
    try {
      if (currentFrameGenerator)
        throw new Error("can't nest rendering");
      currentFrameGenerator = this;
      let result = this.generatorObject.next();
      ret = result.value;
      this.done = result.done; // XXX instead of terminating this should probably just render the last root forever
    } finally {
      currentFrameGenerator = null;
    }

    this.nextFrameTime += this.timePerFrame;
    return ret;
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

function* until(time) {
  if (! currentFrameGenerator)
    throw new Error("this should only be called inside a frame generator");
  if (! currentFrameGenerator.rootNode)
    throw new Error("root node not set yet");

  while (currentFrameGenerator.nextFrameTime < time)
    yield currentFrameGenerator.rootNode.getAt(currentFrameGenerator.nextFrameTime);
}

function Sawtooth(from, to, period) { // no phase for simplicity
  return new class Sawtooth {
    constructor() {
      this.from = from;
      this.to = to;
      this.period = period;
    }

    doubleSpeed() {
      this.period = this.period / 2;
    }

    getAt(time) {
      let ret = this.from + ((time % this.period) / this.period) * (this.to - this.from);
      console.log(`${time} -> ${ret}`);
      return ret;
    }
  }
}
  
function* myScript() {
  let x = Sawtooth(1, 5, 4);
  setRoot(x);
  yield* until(2.2);
  setRoot(Sawtooth(10,20,30));
  yield* until(8);
  setRoot(Sawtooth(1,5,4));
}

let g = new FrameGenerator(myScript, 1);
for (let time = 0; time < 10; time ++) {
  console.log(`${time}: ${g.nextFrame()}`);
}