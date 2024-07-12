// A first attempt at "GraphScript"! I found a better solution with generator functions.

class CreateObjectAction {
  constructor(nodeId, func) {
    this.nodeId = nodeId;
    this.func = func;
  }
}

// XXX - attribute changes aren't implemented, in the sense that there are no setters so nothing adds
// them to the script, and then, in the script, they aren't implemented even if they appear
class SetAttributeToValueAction {
  constructor(nodeId, key, value) {
    this.nodeId = nodeId;
    this.key = key;
    this.value = value;
  }
}

class SetAttributeToNodeAction {
  constructor(nodeId, key, otherNodeId) {
    this.nodeId = nodeId;
    this.key = key;
    this.otherNodeId = otherNodeId;
  }
}

class SetRootAction {
  constructor(nodeId) {
    this.nodeId = nodeId;
  }
}

class GraphScript {
  constructor(commands) {
    this.commands = commands;
    this.nextCommandIndex = 0;
    this.currentTime = 0;
    this.root = null;
    this.nodes = []; // XXX use a weakmap?
  }

  _executeAction(action) {
    if (action instanceof CreateObjectAction) {
      let node = action.func();
      node._nodeId = action.nodeId;
      this.nodes[action.nodeId] = node;
    } else if (action instanceof SetAttributeToValueAction) {
      // XXX implement
    } else if (action instanceof SetAttributeToNodeAction) {
      // XXX implement
    } else if (action instanceof SetRootAction) {
      this.root = this.nodes[action.nodeId];
    } else {
      throw new Error("unrecognized action type");
    }
  }

  evalAtTime(time) {
    if (time < this.currentTime)
      throw new Error("can't go back in time");

    // Advance time
    while (this.nextCommandIndex < this.commands.length) {
      let command = this.commands[this.nextCommandIndex];
      if (command.time > time)
        break; // caught up
      this.currentTime = command.time;
      this.nextCommandIndex ++;
      for (const action of command.actions) {
        this._executeAction(action);
      }
    }
    this.currentTime = time;

    // Evaluate
    if (! this.root)
        throw new Error("no root set for graph");
    return this.root._evalAtTime(time);
  }
}

class GraphScriptCreator {
  constructor() {
    this.commands = [{
      time: 0,
      actions: []
    }];
    this.currentCommand = this.commands[0];
    this.nextNodeId = 0;
  }

  getScript() {
    return new GraphScript(this.commands);
  }

  advanceToTime(time) {
    if (time <= this.currentCommand.time)
      throw new Error("time should be in the future");
    this.currentCommand = {
      time: time,
      actions: []
    };
    this.commands.push(this.currentCommand);
  }

  createNode(func) {
    const obj = func();
    if (Object.hasOwn(obj, '_nodeId'))
      throw new Error("Node shouldn't set its own _nodeId");
    obj._nodeId = this.nextNodeId++;

    // XXX - need to account for nodes passed into ctors! which could be in a nested object or something. attributes
    // have the same issue! so may need to rethink how I do this - maybe node references are always to some kind of
    // a proxy object that has an internal pointer to the actual state, and we can reinitialize everything by finding
    // all of those through a global list and changing out their internal pointers ..
    //
    // (at this point, now that we're just getting a closure and not a class and ctor args, it's an even bigger
    // issue - the nodes are buried inside the closure)
    this.currentCommand.actions.push(
      new CreateObjectAction(obj._nodeId, func)
    );
    return obj;
  }

  setAttribute(obj, key, value) {
    obj[key] = value; // XXX validate 'key'? use a setter? keep these in obj._attributes?

    if (typeof value === "object" && Object.hasOwn(value, '_nodeId')) {
      this.currentCommand.actions.push(
        new SetAttributeToNodeAction(obj._nodeId, key, value._nodeId)
      );
    } else {
      this.currentCommand.actions.push(
        new SetAttributeToValueAction(obj._nodeId, key, value)
      );
    }
  }

  setRoot(obj) {
    if (! Object.hasOwn(obj, '_nodeId'))
      throw new Error("not a node");
    this.currentCommand.actions.push(new SetRootAction(obj._nodeId));
  }
}

function makeNode(name, attributes, evalAtTime, functions) {
  // XXX needs work - and use defineProperty?

  if (! currentGraphScriptCreator)
    throw new Error("this should only be called inside graphscript definitions");

  function constructNode() {
    let node = {
      _name: name,
      _evalAtTime: evalAtTime
    };
    for (const a in attributes) {
      node[a] = attributes[a]; // XXX needs to be setters? or else only set via a set() global? something?
    }
    for (const f in functions) {
      node[f] = functions[f];
    }
    return node;
  }

  return currentGraphScriptCreator.createNode(constructNode);
}

function Sawtooth(from, to, period) { // no phase for simplicity
  return makeNode("Sawtooth", {
    from: from,
    to: to,
    period: period,
  }, function (time) {
    return from + ((time % period) / period) * (to - from);
  }, {
    doubleSpeed: function () {
      this.period = this.period / 2; // XXX requires setters to be captured?
    }
  });
}


let currentGraphScriptCreator = null;

function createGraphScript(func) {
  if (currentGraphScriptCreator)
    throw new Error("Can't create a script from inside a script");
  currentGraphScriptCreator = new GraphScriptCreator;
  try {
    func();
    return currentGraphScriptCreator.getScript();
  } finally {
    currentGraphScriptCreator = null;
  }
}

function at(time) {
  if (! currentGraphScriptCreator)
    throw new Error("this should only be called inside graphscript definitions");
  currentGraphScriptCreator.advanceToTime(time);
}

function setRoot(node) {
  if (! currentGraphScriptCreator)
    throw new Error("this should only be called inside graphscript definitions");
  currentGraphScriptCreator.setRoot(node);
}

function myScript() {
  let x = Sawtooth(1, 5, 4);
  setRoot(x);
  at(2.2);
  setRoot(Sawtooth(10,20,30));
  at(8);
  setRoot(Sawtooth(1,5,4));
}

let script = createGraphScript(myScript);
console.log(script);
for (let time = 0; time < 10; time ++) {
  console.log(`${time}: ${script.evalAtTime(time)}`);
}

// NEXT:
// - Demonstrate that you can set attributes
//   - Requires setters or something like that
// - Demonstrate that you can pass object references into the ctor or as attribute values
//   - Eg, Sawtooth modulated by another Sawtooth, or a thresholding function or whatever
//   - Requires some kind of "proxy object" per above, OR constrain where/how they can appear (eg
//     attributes are a dictionary with object refs only possible at top level and something analogous for ctors)
//   - A good time to clean up evalAtTime to some cleaner/sweeter way to get the value of a node
// - Make Sawtooth stateful (phase determined by when it was created, and adjusting period changes how fast it
//   is advancing through the waveform but doesn't jump you to a different place)
// - Make it render LED patterns - start with scandown and show you can adjust it with LFOs