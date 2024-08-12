import { default as fs } from 'fs';
import { default as process } from 'process';

import { Model } from '../model.js';
import { dist, writeFrame } from '../utils.js';

async function main() {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

  const model = Model.import(config.model);
  const pixelColors = [];

  console.error("Mako");

  const pixelsPerStrand = 70
  let pixelIndex = 0;
  const sizeLine = 4;
  let activatedPixelInStrand = 0;
  for (let frameIndex = 0; ; frameIndex ++) {
    let backgroundColor = [100, 100, 100, 255];
    for (const pixel of model.pixels) {
      pixelColors[pixel.outputChannel()] = backgroundColor
    }
    let strands = model.strands(config.options.big_strand_size, config.options.small_strand_size)
    for (let strandIndex = 0; strandIndex < strands.length; strandIndex++) {
      const strand = strands[strandIndex];
      for (let strandIterator = 0; strandIterator < strand.length; strandIterator++) {
        if ((activatedPixelInStrand-strandIterator) % pixelsPerStrand === 0) {
          for (let i = 0; i < sizeLine && strandIterator+i < strand.length; i++){
            pixelColors[strand[strandIterator+i].outputChannel()] = [50,255,255,255]
          }
        }
      }
    }
    await writeFrame(frameIndex, pixelColors);
    activatedPixelInStrand++;
    if (activatedPixelInStrand > config.options.big_strand_size-sizeLine) {
      activatedPixelInStrand = 0;
    }
  }
}

await main();
