/*****************************************************************************/
/* Model geometry                                                            */
/*****************************************************************************/

export class Pixel {
  constructor(model, point, outputSlot) {
    this.model = model;

    this.id = outputSlot;
    if (model.pixels[this.id] !== undefined)
      throw new Error(`channel collision at channel ${this.id}`)
    model.pixels[this.id] = this;

    this.point = point;
    this.x = this.point[0];
    this.y = this.point[1];
    this.z = this.point[2];

    model.modified = true;
  }

  outputChannel() {
    return this.id;
  }

  _export() {
    return this.point;
  }

  static _import(model, exportedPixels) {
    for (let i = 0; i < exportedPixels.length; i ++) {
      if (exportedPixels[i])
        new Pixel(model, exportedPixels[i], i);
      else
        model.pixels[i] = undefined;
    }
  }
}

export class Node {
  constructor(model, point, info) {
    this.model = model;
    this.id = model.nodes.length;
    model.nodes[this.id] = this;

    this.point = point;
    this.edges = [];
    this.info = info || {};
    this.otherSide = null;

    model.modified = true;
  }

  _export() {
    return {
      point: this.point,
      edges: this.edges.map(edge => edge.id),
      info: this.info,
      otherSide: this.otherSide ? this.otherSide.id : undefined
    }
  }

  static _import(model, exportedNodes) {
    for (const exportedNode of exportedNodes) {
      new Node(model, exportedNode.point, exportedNode.info);
      // Edge information is redundant and will be recomputed when we import the edges
    }

    for (let i = 0; i < exportedNodes.length; i ++) {
      if (exportedNodes[i].otherSide !== undefined)
        model.nodes[i].otherSide = model.nodes[exportedNodes[i].otherSide];
    }
  }
}

export class Edge {
  constructor(model, startNode, endNode, numPixels, firstOutputSlot, info) {
    this.model = model;
    if (startNode.model !== model || endNode.model !== model)
      throw new Error("mixing geometry from different models");

    this.id = model.edges.length;
    model.edges[this.id] = this;

    this.startNode = startNode;
    startNode.edges.push(this);
    this.endNode = endNode;
    endNode.edges.push(this);

    this.info = info || {};
    this.otherSide = null;

    this.pixels = [];
    for(let i = 0; i < numPixels; i ++) {
      // Evenly space the pixels along the edge, with the same space between startNode
      // and the first pixel, and endNode and the last pixel, as between adjacent pixels.
      let frac = (i + 1) / (numPixels + 1);
      let pixel = new Pixel(model,
        [0, 1, 2].map(j =>
          startNode.point[j] + (endNode.point[j] - startNode.point[j]) * frac),
        firstOutputSlot + i
      );
      this.pixels.push(pixel);
    }

    model.modified = true;
  }

  _export() {
    return {
      startNode: this.startNode.id,
      endNode: this.endNode.id,
      pixels: this.pixels.map(pixel => pixel.id),
      info: this.info,
      otherSide: this.otherSide ? this.otherSide.id : undefined
    }
  }

  static _import(model, exportedEdges) {
    for (const exportedEdge of exportedEdges) {
      const e = new Edge(model, model.nodes[exportedEdge.startNode],
        model.nodes[exportedEdge.endNode], 0, null, this.info);
      e.pixels = exportedEdge.pixels.map(id => model.pixels[id]);
    }

    for (let i = 0; i < exportedEdges.length; i ++) {
      if (exportedEdges[i].otherSide !== undefined)
        model.edges[i].otherSide = model.edges[exportedEdges[i].otherSide];
    }
  }
}

export class Model {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.pixels = [];

    this.modified = true;
    this.min = null;
    this.max = null;
  }

  _ensureUpToDate() {
    if (! this.modified)
      return;

    // Compute the (axis-aligned) bounding box of the model
    this.min = [...this.pixels[0].point];
    this.max = [...this.pixels[0].point];

    this.pixels.forEach(pixel => {
      for (let i = 0; i < 3; i ++) {
        this.min[i] = Math.min(this.min[i], pixel.point[i]);
        this.max[i] = Math.max(this.max[i], pixel.point[i]);
      }
    });

    this.modified = false;
  }

  // Return the center of the (axis-aligned) bounding box
  center() {
    this._ensureUpToDate();
    return [0, 1, 2].map(i => (this.max[i] + this.min[i]) / 2);
  }

  pixelCount() {
    return this.pixels.length;
  }

  // XXX this may need to be optimized with an index of some kind
  _findByCriteria(criteria, objects) {
    const matches = [];
    for (let candidate of objects) {
      for (let key of Object.keys(criteria)) {
        if (! candidate[key] !== criteria[key])
          break;
      }
      matches.push(candidate);
    }

    return matches;
  }

  findNodes(criteria) {
    return this._findByCriteria(criteria, this.nodes);
  }

  findEdges(criteria) {
    return this._findByCriteria(criteria, this.edges);
  }

  // Mutate the model by marking two nodes as being the "other side" of each other.
  // This should be done after the model is fully constructed and it will update
  // any edges between other-side-related nodes as well.
  setCorrespondingNodes(node1, node2) {
    if (node1.otherSide === node2 && node2.otherSide === node1)
      return; // already done
    if (node1.otherSide || node2.otherSide)
      throw new Error("can't change side correspondences once set");

    node1.otherSide = node2;
    node2.otherSide = node1;

    // Look for cases where node1 has an edge to some other node X, and node2
    // has an edge to some other node Y, and X and Y also have an other-sidedness
    // relationship. Mark those edges as other sides of each other as well.
    for (let node1Edge of node1.edges) {
      const nodeX =
        node1Edge.startNode === node1 ? node1Edge.endNode : node1Edge.startNode;
      const nodeY = nodeX.otherSide;
      if (! nodeY)
        continue;
      for (let node2Edge of node2.edges) {
        if (node2Edge.startNode === nodeY || node2Edge.endNode === nodeY) {
          if (node1Edge.otherSide || node2Edge.otherSide) {
            if (node1Edge.otherSide !== node2Edge || node2Edge.otherSide !== node1Edge)
              throw new Error("inconsistent edge sidedness relationships - duplicate edges between nodes maybe?")
          } else {
            node1Edge.otherSide = node2Edge;
            node2Edge.otherSide = node1Edge;
          }
        }
      }
    }
  }

  // Validate model invariants (currently, just the sidedness relationships)
  validate(noisy) {
    let nodesWithOtherSide = 0;
    let edgesWithOtherSide = 0;

    for (let node of this.nodes) {
      if (node.otherSide) {
        if (node.otherSide.otherSide !== node)
          throw new Error("model validation failed: node sidedness mismatch");
      }
      nodesWithOtherSide ++;
    }

    for (let edge of this.edges) {
      if (edge.otherSide) {
        if (edge.otherSide.otherSide !== edge)
          throw new Error("model validation failed: edge sidedness mismatch");
        if (! (edge.startNode === edge.otherSide.startNode.otherSide &&
                edge.endNode === edge.otherSide.endNode.otherSide) ||
              (edge.startNode === edge.otherSide.endNode.otherSide &&
                edge.endNode === edge.otherSide.startNode.otherSide))
          throw new Error("model validation failed: node and edge sidedness doesn't correspond correctly");
      }

      edgesWithOtherSide ++;
    }

    if (noisy) {
      console.log(`${nodesWithOtherSide} of ${this.nodes.length} nodes have other sides`);
      console.log(`${edgesWithOtherSide} of ${this.edges.length} edges have other sides`);
    }
  }

  export() {
    return {
      pixels: this.pixels.map(pixel => pixel ? pixel._export() : null),
      nodes: this.nodes.map(node => node._export()),
      edges: this.edges.map(edge => edge._export())
    };
  }

  static import(exportedModel) {
    const model = new Model;

    Pixel._import(model, exportedModel.pixels);
    Node._import(model, exportedModel.nodes);
    Edge._import(model, exportedModel.edges);

    model.validate(false);

    return model;
  }

}
   
