import { default as path } from 'path';
import { pathToRootOfTree } from './utils.js';

let currentScriptGenerator = null;

export class ScriptGenerator {
  // model: a Model to pass to the generator
  // framesPerSecond: the fps to tell the generator to render at
  // scriptPath: this file should contain a default export that is a FrameGenerator compatible generator function
  // options: additional options to pass to the generator as its first argument
  constructor(model, framesPerSecond, scriptPath, options) {
    this.model = model;
    this.timePerFrame = 1.0/framesPerSecond;
    this.rootNode = null;
    this.nextFrameTime = 0;
    this.outputBuffer = Buffer.alloc(4 + this.model.pixelCount() * 4);

    this.scriptPath = path.join(pathToRootOfTree(), 'scripts', scriptPath);
    this.options = options;
    this.generatorObject = null;
    this.lastGeneratorResult = null;
  }

  async getFrame() {
    if (! this.generatorObject) {
      const module = await import(this.scriptPath);
      if (! Object.hasOwn(module, 'default'))
        throw new Error("Script ${this.scripthPath} should have a default export (the generator function for the script)");
      const generatorFunc = module['default'];
      this.generatorObject = generatorFunc(this.options);
    }

    try {
      if (currentScriptGenerator)
        throw new Error("can't nest rendering");
      currentScriptGenerator = this;

      while (! this.lastGeneratorResult ||
          (! this.lastGeneratorResult.done && this.nextFrameTime >= this.lastGeneratorResult.value.untilTime)) {
        this.lastGeneratorResult = this.generatorObject.next();
        if (! this.lastGeneratorResult.done && ! Object.hasOwn(this.lastGeneratorResult.value, 'untilTime'))
          throw new Error("script generator yielded unexpected value");
      }
 
      // should this return a Canvas (with the right pixels currently on it) rather than a raw buffer?
      const buffer = this.rootNode.get();
      if (! buffer instanceof Buffer || buffer.length != this.model.pixelCount() * 4)
        throw new Error("root node of script didn't return a buffer of the right length");
  
      // We're still expecting each frame to be prefixed with a four-byte frame number (currently unused), so
      // we have to put that on. Could refactor to remove the copy for performance.
      this.outputBuffer.writeInt32LE(this.nextFrameNumber ++, 0);
      buffer.copy(this.outputBuffer, 4);

      this.nextFrameTime += this.timePerFrame;
      return this.outputBuffer;
    } finally {
      currentScriptGenerator = null;
    }
  }

  close() {
    // should be able to just let it garbage collected?
  }

  _setRoot(node) {
    this.rootNode = node;
  }
} 

export function setRoot(node) {
  if (! currentScriptGenerator)
    throw new Error("this should only be called inside a script");
  currentScriptGenerator._setRoot(node);
}

export function now() {
  if (! currentScriptGenerator)
    throw new Error("this should only be called inside a script");
  return currentScriptGenerator.nextFrameTime;
}

export function model() {
  if (! currentScriptGenerator)
    throw new Error("this should only be called inside a script");
  return currentScriptGenerator.model;
}

export function untilTime(time) {
  return { untilTime: time };
}
