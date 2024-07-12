let currentFrameGenerator = null;
export class FrameGenerator {
  constructor(model, generatorFunc, fps, options) {
    this.model = model;
    this.generatorObject = generatorFunc(options);
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

export function setRoot(node) {
  if (! currentFrameGenerator)
    throw new Error("this should only be called inside a frame generator");
  currentFrameGenerator._setRoot(node);
}

export function now() {
  if (! currentFrameGenerator)
    throw new Error("this should only be called inside a frame generator");
  return currentFrameGenerator.nextFrameTime;
}

export function model() {
  if (! currentFrameGenerator)
    throw new Error("this should only be called inside a frame generator");
  return currentFrameGenerator.model;
}

export function untilTime(time) {
  return { untilTime: time };
}
