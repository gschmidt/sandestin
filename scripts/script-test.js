import { setRoot, now, model, untilTime } from '../graphscript.js'; // "it's a working title"

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

class Canvas {
  constructor() {
    this.model = model();
    const totalPixels = this.model.pixelCount();
    this.buffer = Buffer.alloc(totalPixels * 4); // RGBA
    this.paintFuncs = [];
  }

  setRGB(outputChannel, r, g, b) {
    let offset = outputChannel * 4;
    this.buffer[offset ++] = r;
    this.buffer[offset ++] = g;
    this.buffer[offset ++] = b;
    this.buffer[offset ++] = 255;
  }

  setRGBA(outputChannel, r, g, b, a) {
    let offset = outputChannel * 4;
    this.buffer[offset ++] = r;
    this.buffer[offset ++] = g;
    this.buffer[offset ++] = b;
    this.buffer[offset ++] = a;
  }

  pushPaintFunc(func) {
    this.paintFuncs.push(func);
  }

  get() {
    for (const func of this.paintFuncs)
      func(this);
    return this.buffer;
  }
}

export default function* () {
  let r = Sawtooth(0, 255, 1);
  let g = Sawtooth(0, 255, 2);
  let b = Sawtooth(0, 255, 3);

  let c = new Canvas;
  setRoot(c);
  c.pushPaintFunc(() => {
    for (const pixel of c.model.pixels) {
      c.setRGB(pixel.outputChannel(), r.get(), g.get(), b.get());
    }
  });

  yield untilTime(5);
  r.doubleSpeed();
  yield untilTime(8);
  g.doubleSpeed();
  yield untilTime(9);
  b.doubleSpeed();
}

