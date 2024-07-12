import { sleep, pathToRootOfTree } from './utils.js';
import { E131Output, WebSocketOutput, sendFrame } from './output.js';
import { Model } from './model.js';
import { default as fs } from 'fs';
import { readFile } from 'fs/promises';
import { default as tmp } from 'tmp';
tmp.setGracefulCleanup();
import { default as path } from 'path';
import { default as child_process } from 'child_process';
import { default as toml } from 'toml';

/*****************************************************************************/
/* Generators (pattern generator programs)                                   */
/*****************************************************************************/

// A generator defined by a JavaScript generator function (in this case, literally a
// generator in the function* sense)
import { ScriptGenerator } from './scripting.js';

// A generator defined by an external program in any language (started as a subprocess)
class ExternalGenerator {
  // model: a Model to pass to the generator
  // framesPerSecond: the fps to tell the generator to render at
  // program: eg 'node', 'python'.. should be in $PATH
  // args: string array of arguments
  // options: JSON object to pass to the program via its config file
  constructor(model, framesPerSecond, program, args, options) {
    const totalPixels = model.pixelCount();
    const frameSize = 4 + 4 * totalPixels;

    const toolConfiguration = {
      framesPerSecond: framesPerSecond, 
      model: model.export(),
      options: options
    };
  
    const tmpobj = tmp.fileSync();
    fs.writeSync(tmpobj.fd, JSON.stringify(toolConfiguration));

    this.child = child_process.spawn(program, [...args, tmpobj.name]);
    console.log(tmpobj.name);
    this.child.on('close', (code) => {
      // XXX handle this?
      console.log(`child process exited with code ${code}`);
    });
    this.child.on('error', (err) => {
      // XXX handle this
      console.log('Failed to start subprocess.');
    });

    this.child.stderr.pipe(process.stderr); // XXX revisit later? at least break it into lines and prefix it?
  
    // if needed for performance, could rewrite this to reduce the number of copies
    // (keep the incoming buffers in an array, and copy out to a buffer, sans frame number, in getFrame())
    async function* packetize(stream) {
      let childBuf = Buffer.alloc(0);
  
      for await (const buf of stream) {
        childBuf = Buffer.concat([childBuf, buf]);
        while (childBuf.length >= frameSize) {
          let frameData = childBuf.subarray(0, frameSize);
          childBuf = childBuf.subarray(frameSize);
          yield frameData;
        }
      }
    }
  
    this.childPacketIterator = packetize(this.child.stdout)[Symbol.asyncIterator]();
  }

  // XXX make it take the wanted frame nummber?
  async getFrame() {
    let item = await this.childPacketIterator.next();
    if (item.done)
      return null; // and perhaps make clean/error exit status available on anotehr method?
    else
      return item.value;
  }

  close() {
    this.child.kill('SIGKILL');
    this.child.unref();
  }
}

/*****************************************************************************/
/* Simulator                                                                 */
/*****************************************************************************/

import { application, default as express } from 'express';

class Simulator {
  constructor(config, model) {
    this.model = model;
    this.port = config.port || 3000;
    this.webSocketPort = config.webSocketPort || this.port + 1;
    this._app = express();

    // Serve static assets
    this._app.use(express.static(path.join(pathToRootOfTree(), 'web')));
  
    // API
    this._app.get('/api/config', (req, res) => {
      const config = {
        webSocketPort: this.webSocketPort,
        model: this.model.export()
      };
      return res.send(JSON.stringify(config));
    });
  
    // Start the server
    this._app.listen(this.port, () => {
      console.log(`Web interface on http://localhost:${this.port}`)
    })
  
  }
}

/*****************************************************************************/
/* Main loop                                                                 */
/*****************************************************************************/

async function main() {
  function usage () {
    console.log("Usage: node app.js <pattern name or playlist file>");
    console.log("If a pattern name, it should be a pattern described in `patterns/patterns.toml`.");
    console.log("If a playlist file, it should be in the same format as `playlist.toml`.")
    console.log("");
  }

  if (process.argv.length !== 3)
    return usage();
  const patternNameOrPlaylistPath = process.argv[2];

  // XXX allow changing config file path via command line option
  const configPath = path.join(pathToRootOfTree(), 'config.toml');
  const configDir = path.dirname(configPath);
  const config = toml.parse(await readFile(configPath));

  // XXX allow pattern list path to be overridden in config file
  const patternListPath = path.join(pathToRootOfTree(), 'patterns', 'patterns.toml');
  const patternsDir = path.dirname(patternListPath);
  const rawPatternList = toml.parse(await readFile(patternListPath));
  const patterns = {};
  for (let pattern of rawPatternList.patterns) {
    patterns[pattern.name] = pattern;
  }

  const model = Model.import(JSON.parse(await readFile(path.join(configDir, config.model))));
  const simulator = config.simulator ? new Simulator(config.simulator, model) : null;

  let framesPerSecond = config.framesPerSecond;
  let msPerFrame = 1000.0 / framesPerSecond;

  const outputs = [];
  if (simulator)
    outputs.push(new WebSocketOutput(simulator.webSocketPort));
  for (const outputConfig of (config.outputs || [])) {
    switch (outputConfig.type) {
      case 'e131':
        outputs.push(new E131Output(outputConfig.host, outputConfig.channels));
        break;
      default:
        throw new Error(`Unknown output type '${outputConfig.type}'`);
    }
  }

  let playlist;
  if (patternNameOrPlaylistPath in patterns) {
    playlist = {
      items: [{
        pattern: patternNameOrPlaylistPath,
        seconds: 60*60*24*365
      }]
    };
  } else {
    playlist = toml.parse(await readFile(patternNameOrPlaylistPath));    
  }
  if (playlist.items.length < 1)
    throw new Error("Playlist must have at least one item");

  function generatorForPlaylistItem(playlistItem) {
    if (playlistItem.script) {
      return new ScriptGenerator(model, framesPerSecond, playlistItem.script, playlistItem.options);
    }

    const pattern = patterns[playlistItem.pattern];
    if (! pattern)
      throw new Error(`no such pattern ${playlistItem.pattern}`);

    const options = {
      ...(pattern.options || {}),
      ...(playlistItem.options || {}),
    };

    return new ExternalGenerator(model, framesPerSecond, pattern.program,
      [ path.join(patternsDir, pattern.script) ], options);
  }

  let playlistOffset = 0;
  let generator = null;
  let nextGenerator = generatorForPlaylistItem(playlist.items[playlistOffset]);
  const pixelColorsMixed = [];

  const powerScale = 1.0;

  while (true) {
    const playlistItem = playlist.items[playlistOffset];
    const nextPlaylistOffset = (playlistOffset + 1) % playlist.items.length;
    const nextPlaylistItem = playlist.items[nextPlaylistOffset];
    
    if (generator)
      generator.close();
    generator = nextGenerator;
    nextGenerator = generatorForPlaylistItem(nextPlaylistItem);

    let lastFrameIndex = null;
    let startTime = Date.now();

    const transitionDurationMs = 5000;
    const transitionEndTimeMs = Date.now() + playlistItem.seconds * 1000;
    const transitionStartTimeMs = transitionEndTimeMs - transitionDurationMs;

    // Currently this is based on wallclock time so that if a pattern drops (doesn't deliver)
    // frames on time, it doesn't extend the amount of time that it runs. But, it would be
    // better in the future to use an exact number of frames, and go ahead with rendering the
    // frame if the pattern doesn't deliver it by the deadline.
    while (Date.now() < transitionEndTimeMs) {
      // We should redo this at some point so that displayTime is actually the time the frame's
      // going to be displayed (for music sync purposes). Currently it's actually the time the
      // frame is rendered.
      // XXX disregard above and rewrite this for new tool model
      let msSinceStart = (Date.now() - startTime);
      let frameIndex = Math.floor(msSinceStart / msPerFrame) + 1;
      let displayTimeMs = startTime + frameIndex * msPerFrame;
      await sleep(displayTimeMs - Date.now());

      // Clear out the mixer framebuffer to black
      for (let i = 0; i < model.pixelCount(); i ++)
        pixelColorsMixed[i] = [0, 0, 0];

      const nextGeneratorWeight =
        Math.max(0, Math.min(1, (Date.now() - transitionStartTimeMs) / transitionDurationMs));

      const framesToMix = [];
      const mainFrameData = await generator.getFrame();
      if (! mainFrameData)
        console.log("warning: pattern exited");
      else
        framesToMix.push({ frameData: mainFrameData, weight: 1 - nextGeneratorWeight });

      if (Date.now() > transitionStartTimeMs) {
        const nextFrameData = await nextGenerator.getFrame();
        if (! nextFrameData)
          console.log("warning: (next) pattern exited");
        else
          framesToMix.push({ frameData: nextFrameData, weight: nextGeneratorWeight });
      }

      // XXX check frame number, loop until we catch up, bail out if we fall too far behind
      for (let frameToMix of framesToMix) {
        for (let i = 0; i < model.pixelCount(); i ++) {
          let r = frameToMix.frameData.readUint8(4 + i * 4 + 0);
          let g = frameToMix.frameData.readUint8(4 + i * 4 + 1);
          let b = frameToMix.frameData.readUint8(4 + i * 4 + 2);
          let a = frameToMix.frameData.readUint8(4 + i * 4 + 3);
          // TODO: mix based on alpha :)
          pixelColorsMixed[i][0] += r * frameToMix.weight * powerScale;
          pixelColorsMixed[i][1] += g * frameToMix.weight * powerScale;
          pixelColorsMixed[i][2] += b * frameToMix.weight * powerScale;
        }
      }

      await sendFrame(pixelColorsMixed, outputs);

      // XXX this needs to be redone or at least re-examined - is it even meaningful
      // with multiple generators running..
      if (lastFrameIndex !== null && lastFrameIndex !== frameIndex - 1) {
        console.log(`warning: skipped frames from ${lastFrameIndex} to ${frameIndex}`);
      }
      lastFrameIndex = frameIndex;
    }

    playlistOffset = nextPlaylistOffset;
  }

  if (generator)
    generator.close();
  if (nextGenerator)
    nextGenerator.close();
}

await main();

// XXX mixer notes:
// new_value = pixel * alpha + old_value * (1 - alpha)
//
// effective_alpha = pixel_alpha * layer_alpha
// new_value = pixel * effective_alpha + old_value * (1 - effective_alpha)
//
// From backmost layer to frontmost layer
// You can avoid divisions by doing one rescale per layer (which can be a multiplication)
// At the end you get a double per LED channel which you could gamma correct if desired
