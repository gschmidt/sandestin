import { Pixel, Node, Edge, Model } from '../model.js';
import { writeFile } from 'fs/promises';
import { dist, pathToRootOfTree } from '../utils.js';
import { readObjFile } from './read-obj-file.js';
import * as path from 'path';

/* Zome address map (assuming standard zome.obj):

(1) There are 10 receiver boxes, each at a bottom vertex, numbered 0-9
    clockwise around the zome. (Clockwise as seen from above, or in other
    words, the direction you go if you walk around the zome with it on
    your right hand side.) The zome is rotationally symmetric so it
    doesn't matter which one is 0.
(2) Each receiver board has four ports:
    Port 1: Counterclockwise outer, 315 pixels
    Port 2: Counterclockwise inner, 315 pixels
    Port 3: Clockwise outer, 360 pixels
    Port 4: Clockwise inner, 360 pixels
    (XXX we might want to change this so that clockwise comes
         first, matching the vertex order, but this is how it
         is currently)
(3) LEDs are mapped to consecutive addresses: to receivers 0-9 in
    ascending (clockwise) order, then within a receiver to ports 0-3
    in ascending order, then on an individual strand, from the bottom
    of the sturcture to the top.

Geometry:

(1) The Z axis points up (the elevation, from the ground to the sky.)
(2) Units are in meters.

Channel order:

For the LED strips we bought for the Dragon Egg, channel order should be
set to BGR in the Falcon controller (this seems to be the channel order
in the physical strips) and "rgb" in our own config file (which seems
to be what the Falcon controller expects.)

*/

// XXX check that clockwise/counterclockwise directions match the simulator
// (they match the physical zome - but make sure it works in simulator
// coordinate system too)

const EPSILON = .1; // 1 centimeter
const PI = Math.PI;
const METERS_PER_INCH = .0254;

const pixelsPerMeter = 60;
const strutWidth = 1.5 * METERS_PER_INCH;

function isClockwise(from, to) {
  function normalizeRadians(theta) {
    // Normalize angle to [0, 2*PI)
    return ((theta % (2 * PI)) + 2 * PI) % (2 * PI);
  }
   
  return normalizeRadians(from.cyl.theta - to.cyl.theta) <
    normalizeRadians(to.cyl.theta - from.cyl.theta);
}

function findNextVert(vert, accept) {
  for (let v of vert.edgesTo) {
    if (v.cyl.z - vert.cyl.z < EPSILON)
      continue; // consider upward movements only

      if (v.cyl.r <= EPSILON) {
      // This edge leads to the center, where theta is undefined
      if (accept.center)
        return v;
      continue;
    }

    if (isClockwise(vert, v)) {
      if (accept.clockwise)
        return v;
      continue;
    } else {
      if (accept.counterclockwise)
        return v;
      continue;
    }
  }

  return null;
}
  
async function buildZomeFromObjFile(pathToObjFile) {
  let model = new Model;
  let nextOutputSlot = 0;

  // Read in the mesh
  const verts = await readObjFile(pathToObjFile);

  // Compute extents and centroid
  let min = [...verts[0].point];
  let max = [...verts[0].point];
  let centroid = [0, 0, 0];
  for (let v of verts) {
    for (let i = 0; i < 3; i ++) {
      min[i] = Math.min(min[i], v.point[i]);
      max[i] = Math.max(max[i], v.point[i]);
      centroid[i] += v.point[i] / verts.length;
    }
  }

  // Compute cylindrical coordinates (with z axis through centroid as axis of cylinder, and z=0 as bottom of model)
  for (let v of verts) {
    const translated = [ v.point[0] - centroid[0], v.point[1] - centroid[1], v.point[2] - min[2] ];
    v.cyl = {
      r: Math.sqrt(translated[0] * translated[0] + translated[1] * translated[1]),
      theta: Math.atan2(translated[1], translated[0]),
      z: translated[2]
    };
    v.t = translated;
  }

  // Find bottom vertices (based on which are within EPSILON of the ground). Sort them in a circle, clockwise
  let baseVerts = [];
  for (let v of verts)
    if (v.point[2] <= EPSILON)
      baseVerts.push(v);
  baseVerts.sort((v1, v2) => v2.cyl.theta - v1.cyl.theta);

  // Count the number of tiers in the zome
  let numTiers = 0;
  for (let v = baseVerts[0]; v !== null; v = findNextVert(v, { clockwise: true, center: true })) {
    numTiers ++;
  }
  console.log(`the zome has ${numTiers} tiers`);

  // Now trace the LED strands up from each bottom vertex in both clockwise and counterclockwise directions.
  // Do clockwise first and let the clockwise strand be the one traced all the way up to the top.
  function traceStrand(start, accept, side) {
    let startOutputSlot = nextOutputSlot;
    let sideName = side ? "in" : "out";
    let spinName = accept.clockwise ? "cw" : "ccw";

    let from = start;
    let tier = numTiers - 1; // tiers are 0-based
    while (from) {
      let to = findNextVert(from, accept);
      if (! to)
        break;
      console.log(`segment from ${JSON.stringify(from.cyl)} to ${JSON.stringify(to.cyl)} (tier ${tier - 1} to ${tier})`);

      function displace(point) {
        // Move half a strut width toward (side == 0) or away (side == 1) the center line
        const toCenterLine = [point[0] - centroid[0], point[1] - centroid[1]];
        const mag = Math.sqrt(toCenterLine[0] * toCenterLine[0] + toCenterLine[1] * toCenterLine[1]);
        const scale = (strutWidth / 2) / mag * (side === 0 ? -1 : 1);
        return [point[0] + toCenterLine[0] * scale, point[1] + toCenterLine[1] * scale, point[2]];
      }

      const nodeKey = `side${side}Node`;
      if (! from[nodeKey])
        from[nodeKey] = new Node(model, displace(from.point), { tier: tier, side: sideName });
      if (! to[nodeKey])
        to[nodeKey] = new Node(model, displace(to.point), { tier: tier - 1, side: sideName });

      const pixelsOnEdge = Math.round(pixelsPerMeter * dist(from.point, to.point));
      new Edge(model, from[nodeKey], to[nodeKey], pixelsOnEdge, nextOutputSlot,
        { from: tier - 1, to: tier, spin: spinName, side: sideName});
      nextOutputSlot += pixelsOnEdge;

      from = to;
      tier --;
    }

    console.log(`total ${nextOutputSlot - startOutputSlot} pixels in strand`);
  }

  let receiver = 0;
  for (let base of baseVerts) {
    console.log(`** Receiver ${receiver}:`);
    traceStrand(base, { counterclockwise: true }, 0); // CCW outer
    traceStrand(base, { clockwise: true, center: true }, 0); // CW outer
    traceStrand(base, { counterclockwise: true }, 1); // CCW inner
    traceStrand(base, { clockwise: true, center: true }, 1); // CW inner
    receiver ++;
  }

  // Finally, match up the sides
  for (let v of verts) {
    if (! v.side0Node || ! v.side1Node)
      throw new Error("nodes weren't created for both sides of vert?");
    model.setCorrespondingNodes(v.side0Node, v.side1Node);
  }

  model.validate(true);
  return model;
}

async function main() {
  const model = await buildZomeFromObjFile(path.join(pathToRootOfTree(), 'models', 'zome.obj'));
  const filename = path.join(pathToRootOfTree(), 'models', 'full-zome.model');
  await writeFile(filename, JSON.stringify(model.export()));
}


await main();