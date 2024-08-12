import { default as fs } from 'fs';
import { default as process } from 'process';

import { Model } from '../model.js';
import { dist, writeFrame } from '../utils.js';

async function main() {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

  const model = Model.import(config.model);
  const pixelColors = [];

  console.error("Fire");

  const firstGradient = [1, true]
  let firstGradientSway = 3;
  const maxSway = 100;

  for (let frameIndex = 0; ; frameIndex ++) {
    let strands = model.strands(config.options.big_strand_size, config.options.small_strand_size)
    firstGradient[1] ? firstGradient[0]+=firstGradientSway : firstGradient[0]-=firstGradientSway;
    if (Math.abs(firstGradient[0]) >= maxSway) {
      firstGradient[1] = !firstGradient[1]
    }
    for (let strandIndex = 0; strandIndex < strands.length; strandIndex++) {
      const strand = strands[strandIndex];
      for (let strandIterator = 0; strandIterator < strand.length; strandIterator++) {
        if (strandIterator > 315) {
          pixelColors[strand[strandIterator].outputChannel()] = [255, 0, 0];
        } else {
          pixelColors[strand[strandIterator].outputChannel()] = [255, Math.max(0, Math.min(255, strandIterator+firstGradient[0])), 0];
        }
      }
    }
    await writeFrame(frameIndex, pixelColors);
  }
}

await main();
