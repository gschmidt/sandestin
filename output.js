/*****************************************************************************/
/* E131 devices                                                              */
/*****************************************************************************/

import { default as e131 } from 'e131';

export class E131Output {
  constructor(host, format) {
    this.host = host; // XXX do DNS resolution and also pull out port if any
    this._format = format;
    this.e131Client = new e131.Client(this.host);  // or use a universe
  }

  _sendFrame(buffer) {
    const self = this;

    return new Promise(resolve => {
      var i = 0;
      var pos = 0;
  
      var startUniverse = 1;
      var thisUniverse = startUniverse;
      var channelsPerUniverse = 510;
      var packets = [];
      var totalChannels = buffer.length;
      for (let idx = 0; idx < totalChannels; ) {
        var theseChannels = Math.min(totalChannels - idx, channelsPerUniverse);
        var p = this.e131Client.createPacket(theseChannels);
        p.setSourceName('sandestin');
        p.setUniverse(thisUniverse);
        p.setPriority(p.DEFAULT_PRIORITY);  // not strictly needed, done automatically
        packets.push(p);
        idx += theseChannels;
        thisUniverse ++;
      }
      
      function sendNextPacket() {
        if (i === packets.length) {
          resolve();
        } else {
          var p = packets[i];
          i += 1;
          var slotsData = p.getSlotsData();
          buffer.copy(slotsData, 0, pos);
          pos += slotsData.length;
          self.e131Client.send(p, sendNextPacket);
        }
      } 
  
      sendNextPacket();
    });
  }
}

/*****************************************************************************/
/* WebSocket server (for simulator)                                          */
/*****************************************************************************/

import { WebSocketServer } from 'ws';

export class WebSocketOutput {
  constructor(port, format) { // XXX automatically allocate port? but we also want auto-reconnect..
    this.port = port || 3001;
    this._server = new WebSocketServer({ port: this.port });
    this._format = format || "grb";
    this._connections = new Set;

    this._server.on('connection', ws => {
      this._server.on('message', data => {
        // Ignore incoming websocket messages for now
      });
    
      this._server.on('close', (code, reason) => {
        console.log(`Connection closed: ${code} ${reason}`)
        this._connections.delete(ws);
      });
    
      this._connections.add(ws);
    });
  }

  async _sendFrame(buffer) {
    const promises = [];

    for (const ws of this._connections)
      promises.push(new Promise(resolve => { ws.send(buffer, {}, resolve) } ));

    await Promise.all(promises);
  }
}

/*****************************************************************************/
/* Sending frames                                                            */
/*****************************************************************************/

const parseFormatCache = {};
function parseFormat(format) {
  function _parseFormat(format) {
    const keys = {r: 0, g: 1, b: 2, '-': null};
    const channelMap = [];
    let paddingChannels = 0;

    for (let i = 0; i < format.length; i ++) {
      const channel = keys[format.toLowerCase()[i]];
      if (channel === undefined)
        throw new Error(`Bad pixel format ${format}: allowed characters are 'r', 'g', 'b', and '-' (for padding, eg, warm white)`);
      if (paddingChannels > 0 && channel !== null)
        throw new Error(`Bad pixel format ${format}: padding channels may only appear at the end of the string`);
      if (channel === null)
        paddingChannels ++;
      else
        channelMap.push(channel);
    }

    if (channelMap.length !== 3)
      throw new Error(`Bad pixel format ${format}: each of 'r', 'g', and 'b' must appear once`);

    if (paddingChannels > 2)
      // If you increase the limit adjust the unrolled loop in `buildBuffer`
      throw new Error(`Bad pixel format ${format}: there is a limit of two padding channels`);

    return {
      channelMap: channelMap,
      paddingChannels: paddingChannels,
      channelsPerPixel: channelMap.length + paddingChannels
    };
  }

  let parsed = parseFormatCache[format];
  if (! parsed)
    parsed = parseFormatCache[format] = _parseFormat(format);
  return parsed;
}

function buildBuffer(pixelColors, parsedFormat) {
  const totalChannels = pixelColors.length * parsedFormat.channelsPerPixel;

  // Asssemble the frame data
  var buffer = Buffer.alloc(totalChannels);
  let offset = 0;
  for (let i = 0; i < pixelColors.length; i ++) {
    buffer[offset ++] = pixelColors[i][parsedFormat.channelMap[0]];
    buffer[offset ++] = pixelColors[i][parsedFormat.channelMap[1]];
    buffer[offset ++] = pixelColors[i][parsedFormat.channelMap[2]];
    if (parsedFormat.paddingChannels > 0)
      buffer[offset ++] = 0;
    if (parsedFormat.paddingChannels > 1)
      buffer[offset ++] = 0;
  }

  if (offset !== totalChannels)
    throw new Error("didn't output right number of channels?");
  
  return buffer;
}

// - outputs: an array of XXXOutput objects
// - pixelColors: an array of RGB colors (each channel in the range 0-255)
//   eg: [[12, 45, 255], [0, 255, 0], ...]
export async function sendFrame(pixelColors, outputs) {
  const bufferCache = {};
  const promises = [];

  for (const output of outputs) {
    let format = output._format;
    let buffer = bufferCache[format];
    if (! buffer)
      buffer = bufferCache[format] = buildBuffer(pixelColors, parseFormat(format));
    promises.push(output._sendFrame(buffer));
  }

  await Promise.all(promises);
}
