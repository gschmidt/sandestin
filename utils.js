import * as path from 'path';
import { fileURLToPath } from 'url';

// "await sleep(1000)"
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Distance between two points in 3 dimensional space, each represented as an array
export function dist(point1, point2) {
  let dx = point1[0] - point2[0];
  let dy = point1[1] - point2[1];
  let dz = point1[2] - point2[2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// Send a frame to stdout (and thus to the mixer for display).
// - frameIndex: the integer index of the frame (should start at 0)
// - pixelColors: an array of the form [[R,G,B,A],[R,G,B,A]].., of a length equal to
//   model.pixelCount(), with each value between 0 and 255 inclusive
export async function writeFrame(frameIndex, pixelColors) {
  const buf = Buffer.allocUnsafe(4 + pixelColors.length * 4);
  let offset = 0;

  buf.writeInt32LE(frameIndex, 0);
  offset += 4;

  for (let pixelIndex = 0; pixelIndex < pixelColors.length; pixelIndex ++) {
    buf.writeUint8(pixelColors[pixelIndex][0], offset ++); // R
    buf.writeUint8(pixelColors[pixelIndex][1], offset ++); // G
    buf.writeUint8(pixelColors[pixelIndex][2], offset ++); // B
    buf.writeUint8(pixelColors[pixelIndex][3], offset ++); // A
  }

  function writeAsyncToStream(stream, data) {
    return new Promise((resolve, reject) => {
      const canWrite = stream.write(data);
  
      if (canWrite) {
        resolve();
      } else {
        stream.once('drain', resolve);
      }
  
      // XXX not sure what to do here - it seems like we should catch errors but this is a memory leak
      // stream.on('error', reject);
    });
  }
  
  await writeAsyncToStream(process.stdout, buf);
}

// Return a random integer in [min, max]
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pathToRootOfTree() {
  return path.dirname(fileURLToPath(import.meta.url));
}
