/* @requires mapshaper-common, core.geo */

var Visvalingam = {};

Utils.arrayCompare = function(a, b) {
  if(a.length != b.length) {
    trace("Mismatched len:", a.length, b.length);
    return;
  }

  for (var i=0; i<a.length; i++) {
    if (a[i] != b[i]) {
      trace( "Mismatch at", i, "--", a[i], b[i]);
      return false;
    }
  }
  return true;
}


Visvalingam.getArcCalculator = function(metric2D, metric3D) {
  var bufLen = 0,
      heap = new VisvalingamHeap(),
      prevArr, nextArr;

  // Calculate Visvalingam simplification data for an arc
  // Receives arrays of x- and y- coordinates, optional array of z- coords
  // Returns an array of simplification thresholds, one per arc vertex.
  //
  var calcArcData = function(xx, yy, zz, len) {
    var arcLen = len || xx.length,
        useZ = !!zz,
        threshold,
        ax, ay, bx, by, cx, cy;

    if (arcLen > bufLen) {
      bufLen = Math.round(arcLen * 1.2);
      prevArr = new Int32Array(bufLen);
      nextArr = new Int32Array(bufLen);
    }

    heap.init(arcLen-2); // Initialize the heap with room for the arc's internal coordinates.

    // Initialize Visvalingam "effective area" values and references to prev/next points for each point in arc.
    //
    for (var i=1; i<arcLen-1; i++) {
      ax = xx[i-1];
      ay = yy[i-1];
      bx = xx[i];
      by = yy[i];
      cx = xx[i+1];
      cy = yy[i+1];

      if (!useZ) {
        threshold = metric2D(ax, ay, bx, by, cx, cy);
      } else {
        threshold = metric3D(ax, ay, zz[i-1], bx, by, zz[i], cx, cy, zz[i+1]);
      }

      heap.addValue(i, threshold);
      nextArr[i] = i + 1;
      prevArr[i] = i - 1;
    }
    prevArr[arcLen-1] = arcLen - 2;
    nextArr[0] = 1;

    // Calculate removal thresholds for each internal point in the arc
    //
    var idx, nextIdx, prevIdx;
    var arr = [];
    while(heap.heapSize() > 0) {

      // Remove the point with the least effective area.
      idx = heap.pop();
      if (idx < 1 || idx > arcLen - 2) {
        error("Popped first or last arc vertex (error condition); idx:", idx, "len:", len);
      }

      // Recompute effective area of neighbors of the removed point.
      prevIdx = prevArr[idx];
      nextIdx = nextArr[idx];
      ax = xx[prevIdx];
      ay = yy[prevIdx];
      bx = xx[nextIdx];
      by = yy[nextIdx];

      if (prevIdx > 0) {
        cx = xx[prevArr[prevIdx]];
        cy = yy[prevArr[prevIdx]];
        if (!useZ) {
          threshold = metric2D(bx, by, ax, ay, cx, cy); // next point, prev point, prev-prev point
        } else {
          threshold = metric3D(bx, by, zz[nextIdx], ax, ay, zz[prevIdx], cx, cy, zz[prevArr[prevIdx]]);
        }
        heap.updateValue(prevIdx, threshold);
      }
      if (nextIdx < arcLen-1) {
        cx = xx[nextArr[nextIdx]];
        cy = yy[nextArr[nextIdx]];
        if (!useZ) {
          threshold = metric2D(ax, ay, bx, by, cx, cy); // prev point, next point, next-next point
        } else {
          threshold = metric3D(ax, ay, zz[prevIdx], bx, by, zz[nextIdx], cx, cy, zz[nextArr[nextIdx]]);
        }
        heap.updateValue(nextIdx, threshold);
      }
      nextArr[prevIdx] = nextIdx;
      prevArr[nextIdx] = prevIdx;
    }
    return heap.values();
  };

  return calcArcData;
};


// Calc area of triangle from three points
//
function triangleArea(ax, ay, bx, by, cx, cy) {
  return Math.abs(((ay - cy) * (bx - cx) + (by - cy) * (cx - ax)) / 2);
}

//
//
function detSq(ax, ay, bx, by, cx, cy) {
  var det = ax * by - ax * cy + bx * cy - bx * ay + cx * ay - cx * by;
  return det * det;
}

// Calc area of 3D triangle from three points
//
function triangleArea3D(ax, ay, az, bx, by, bz, cx, cy, cz) {
  var area = 0.5 * Math.sqrt(detSq(ax, ay, bx, by, cx, cy) + detSq(ax, az, bx, bz, cx, cz) + detSq(ay, az, by, bz, cy, cz));
  return area;
}

// Calc angle in radians given three coordinates with (bx,by) at the vertex.
// atan2() very slow; replaced by a faster formula 
/*
function innerAngle_v1(ax, ay, bx, by, cx, cy) {
  var a1 = Math.atan2(ay - by, ax - bx),
      a2 = Math.atan2(cy - by, cx - bx),
      a3 = Math.abs(a1 - a2);
  if (a3 > Math.PI) {
    a3 = 2 * Math.PI - a3;
  }
  return a3;
}
*/

function distance3D(ax, ay, az, bx, by, bz) {
  var dx = ax - bx,
      dy = ay - by,
      dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}


function innerAngle(ax, ay, bx, by, cx, cy) {
  var ab = Point.distance(ax, ay, bx, by),
      bc = Point.distance(bx, by, cx, cy),
      dp = (ax - bx) * (cx - bx) + (ay - by) * (cy - by) / (ab * bc);
      theta = dp >= 1 ? 0 : Math.acos(dp); // handle rounding error.
  return theta;
}


function innerAngle3D(ax, ay, az, bx, by, bz, cx, cy, cz) {
  var ab = distance3D(ax, ay, az, bx, by, bz);
  var bc = distance3D(bx, by, bz, cx, cy, cz);
  var dp = ((ax - bx) * (cx - bx) + (ay - by) * (cy - by) + (az - bz) * (cz - bz)) / (ab * bc);
  var theta = dp >= 1 ? 0 : Math.acos(dp);
  return theta;
}


// The original mapshaper "modified Visvalingam" function uses a step function to 
// underweight more acute triangles.
//
Visvalingam.specialMetric = function(ax, ay, bx, by, cx, cy) {
  var area = triangleArea(ax, ay, bx, by, cx, cy),
      angle = innerAngle(ax, ay, bx, by, cx, cy),
      weight = angle < 0.5 ? 0.1 : angle < 1 ? 0.3 : 1;
  return area * weight;
};


Visvalingam.specialMetric3D = function(ax, ay, az, bx, by, bz, cx, cy, cz) {
  var area = triangleArea3D(ax, ay, az, bx, by, bz, cx, cy, cz),
      angle = innerAngle3D(ax, ay, az, bx, by, bz, cx, cy, cz),
      weight = angle < 0.5 ? 0.1 : angle < 1 ? 0.3 : 1;
  return area * weight;
};


// Experimenting with a replacement for "Modified Visvalingam"
//
Visvalingam.specialMetric2 = function(ax, ay, bx, by, cx, cy) {
  var area = triangleArea(ax, ay, bx, by, cx, cy),
      standardLen = area * 1.4,
      hyp = Math.sqrt((ax + cx) * (ax + cx) + (ay + cy) * (ay + cy)),
      weight = hyp / standardLen;
  return area * weight;
};

// standard Visvalingam metric is triangle area
Visvalingam.standardSimplify = Visvalingam.getArcCalculator(triangleArea, triangleArea3D);
Visvalingam.modifiedSimplify = Visvalingam.getArcCalculator(Visvalingam.specialMetric, Visvalingam.specialMetric3D);


// A heap data structure used for computing Visvalingam simplification data.
// 
function VisvalingamHeap() {
  var bufLen = 0,
      maxItems = 0,
      maxIdx, minIdx,
      itemsInHeap,
      poppedVal,
      heapArr, indexArr, valueArr;

  // Prepare the heap for simplifying a new arc.
  //
  this.init = function(size) {
    if (size > bufLen) {
      bufLen = Math.round(size * 1.2);
      heapArr = new Int32Array(bufLen);
      indexArr = new Int32Array(bufLen + 2); // requires larger...
    }
    itemsInHeap = 0;
    poppedVal = -Infinity;
    valueArr = new Float64Array(size + 2);
    valueArr[0] = valueArr[size+1] = Infinity;
    minIdx = 1; 
    maxIdx = size;
    maxItems = size;
  };

  // Add an item to the bottom of the heap and restore heap order.
  //
  this.addValue = function(valIdx, val) {
    var heapIdx = itemsInHeap++;
    if (itemsInHeap > maxItems) error("Heap overflow.");
    if (valIdx < minIdx || valIdx > maxIdx) error("Out-of-bounds point index.");
    valueArr[valIdx] = val;
    heapArr[heapIdx] = valIdx
    indexArr[valIdx] = heapIdx;
    reHeap(heapIdx);
  };

  // Return an array of threshold data after simplification is complete.
  //
  this.values = function() {
    assert(itemsInHeap == 0, "[VisvalingamHeap.values()] Items remain on the heap.");
    return valueArr;
  }

  this.heapSize = function() {
    return itemsInHeap;
  }

  // Update the value of a point in the arc.
  //
  this.updateValue = function(valIdx, val) {
    if (valIdx < minIdx || valIdx > maxIdx) error("Out-of-range point index.");
    if (val < poppedVal) {
      // don't give updated values a lesser value than the last popped vertex...
      val = poppedVal;
    }
    valueArr[valIdx] = val;
    var heapIdx = indexArr[valIdx];
    if (heapIdx < 0 || heapIdx >= itemsInHeap) error("[updateValue()] out-of-range heap index.");
    reHeap(heapIdx);
  };

  // Check that heap is ordered starting at a given node
  // (traverses heap recursively)
  //
  function checkNode(heapIdx, parentVal) {
    if (heapIdx >= itemsInHeap) {
      return;
    }
    var valIdx = heapArr[heapIdx];
    var val = valueArr[valIdx];
    assert(parentVal <= val, "[checkNode()] heap is out-of-order at idx:", heapIdx, "-- parentVal:", parentVal, "nodeVal:", val);
    var childIdx = heapIdx * 2 + 1;
    checkNode(childIdx, val);
    checkNode(childIdx + 1, val);
  }

  function checkHeapOrder() {
    checkNode(0, -Infinity);
  }

  function getHeapValues() {
    var arr = [];
    for (var i=0; i<itemsInHeap; i++) {
      arr.push(valueArr[heapArr[i]]);
    }
    return arr;
  }

  // Function restores order to the heap (lesser values towards the top of the heap)
  // Receives the idx of a heap item that has just been changed or added.
  // (Assumes the rest of the heap is ordered, this item may be out-of-order)
  //
  function reHeap(currIdx) {
    var currValIdx,
        currVal,
        parentIdx,
        parentValIdx,
        parentVal;

    if (currIdx < 0 || currIdx >= itemsInHeap) error("Out-of-bounds heap idx passed to reHeap()");
    currValIdx = heapArr[currIdx];
    currVal = valueArr[currValIdx];

    // Bubbling phase:
    // Move item up in the heap until it's at the top or is heavier than its parent
    //
    while (currIdx > 0) {
      parentIdx = (currIdx - 1) >> 1; // integer division by two gives idx of parent
      parentValIdx = heapArr[parentIdx];
      parentVal = valueArr[parentValIdx];

      if (parentVal <= currVal) {
        break;
      }

      // out-of-order; swap child && parent
      indexArr[parentValIdx] = currIdx;
      indexArr[currValIdx] = parentIdx;
      heapArr[parentIdx] = currValIdx;
      heapArr[currIdx] = parentValIdx;
      currIdx = parentIdx;
      if(valueArr[heapArr[currIdx]] !== currVal) error("Lost value association");
    }

    // Percolating phase:
    // Item gets swapped with any lighter children
    //
    var childIdx = 2 * currIdx + 1,
        childValIdx, childVal,
        otherChildIdx, otherChildValIdx, otherChildVal;

    while (childIdx < itemsInHeap) {
      childValIdx = heapArr[childIdx];
      childVal = valueArr[childValIdx];

      otherChildIdx = childIdx + 1;
      if (otherChildIdx < itemsInHeap) {
        otherChildValIdx = heapArr[otherChildIdx];
        otherChildVal = valueArr[otherChildValIdx];
        if (otherChildVal < childVal) {
          childIdx = otherChildIdx;
          childValIdx = otherChildValIdx;
          childVal = otherChildVal;
        }
      }

      if (currVal <= childVal) {
        break;
      }

      // swap curr item and child w/ lesser value
      heapArr[childIdx] = currValIdx;
      heapArr[currIdx] = childValIdx;
      indexArr[childValIdx] = currIdx;
      indexArr[currValIdx] = childIdx;

      // descend in the heap:
      currIdx = childIdx;
      childIdx = 2 * currIdx + 1;
    }
  };

  // Return the idx of the lowest-value item in the heap
  //
  this.pop = function() {
    if (itemsInHeap <= 0) error("Tried to pop from an empty heap.");
    if (poppedVal === -Infinity) {
      if (itemsInHeap != maxItems) error("pop() called before heap is populated.");
      // trace(indexArr.subarray(1, itemsInHeap + 1));
    }
    // get min-val item from top of heap...
    var minIdx = heapArr[0],
        minVal = valueArr[minIdx],
        lastIdx;

    lastIdx = --itemsInHeap;
    if (itemsInHeap > 0) {
      heapArr[0] = heapArr[lastIdx]; // copy last item in heap into root position
      indexArr[heapArr[0]] = 0;
      reHeap(0);
    }

    if (minVal < poppedVal) error("[VisvalingamHeap.pop()] out-of-sequence value; prev:", poppedVal, "new:", minVal);
    poppedVal = minVal;
    return minIdx;
  };
}