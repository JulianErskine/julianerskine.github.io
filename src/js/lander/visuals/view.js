// How the sim's play plane sits in the 3D world, and the camera that looks at
// it. The plane (x right, y down, `width` x `height`) is placed at z = 0 with
// y flipped to point up; one world unit is one plane px. +z is toward the
// camera, -z is into the distance.
//
// The camera sits on the plane's normal and looks straight down -z, with an
// off-axis frustum framing exactly the plane's rectangle at z = 0. So the
// plane maps to the screen linearly, as the old 2D canvas did, while the
// ground in front of and behind it is seen in true perspective. The eye is
// low (`eye`), putting the horizon below the middle of the frame.
import * as THREE from "three";

export function createView(width, height) {
  return {
    width,
    height,
    centerX: width / 2,
    distance: 700, // camera to the play plane
    eye: 200, // camera height, world y; also where the horizon lands
    near: 20,
    far: 30000,
    planeToWorld(x, y, out = new THREE.Vector3()) {
      return out.set(x, height - y, 0);
    },
    // World x at depth z that lands on screen where plane x would at z = 0.
    screenX(x, z) {
      return this.centerX + ((x - this.centerX) * this.distance) / (this.distance - z);
    },
  };
}

export function createCamera(view) {
  const { width, height, centerX, distance, eye, near, far } = view;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(centerX, eye, distance);
  camera.lookAt(centerX, eye, 0);
  camera.near = near;
  camera.far = far;
  const k = near / distance;
  camera.projectionMatrix.makePerspective(
    -(width / 2) * k, (width / 2) * k, (height - eye) * k, -eye * k, near, far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  // The frustum is off-axis: anything calling updateProjectionMatrix() would
  // replace it with a centred one, so make that a no-op.
  camera.updateProjectionMatrix = () => {};
  return camera;
}
