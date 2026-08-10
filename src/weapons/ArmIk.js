/**
 * IK brazos Mixamo → grips del arma.
 * CCD para posición (estable en este rig) + orientación suave de la palma al arma.
 */
import * as THREE from 'three';

const _targetPos = new THREE.Vector3();
const _effectorPos = new THREE.Vector3();
const _linkPos = new THREE.Vector3();
const _invLinkQ = new THREE.Quaternion();
const _linkScale = new THREE.Vector3();
const _effectorVec = new THREE.Vector3();
const _targetVec = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quatBlend = new THREE.Quaternion();
const _id = new THREE.Quaternion();
const _shoulderPos = new THREE.Vector3();
const _elbowPos = new THREE.Vector3();
const _handPos = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _toElbow = new THREE.Vector3();
const _toPole = new THREE.Vector3();
const _boneUp = new THREE.Vector3();
const _pArm = new THREE.Vector3();
const _pFore = new THREE.Vector3();
const _palm = new THREE.Vector3();
const _toGun = new THREE.Vector3();
const _qWorld = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qLocal = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();

export function solveCcdIk({
  links,
  effector,
  targetWorld,
  iteration = 12,
  maxAngle = 0.6,
  blend = 1
}) {
  if (!effector || !links?.length || !targetWorld) return;
  const chain = links.filter(Boolean);
  if (!chain.length) return;

  _targetPos.copy(targetWorld);

  const root = chain[chain.length - 1];
  if (root?.parent) root.parent.updateWorldMatrix(true, false);
  for (let i = chain.length - 1; i >= 0; i--) chain[i].updateWorldMatrix(false, false);
  effector.updateWorldMatrix(false, false);

  for (let it = 0; it < iteration; it++) {
    for (let j = 0; j < chain.length; j++) {
      const link = chain[j];
      link.matrixWorld.decompose(_linkPos, _invLinkQ, _linkScale);
      _invLinkQ.invert();

      _effectorPos.setFromMatrixPosition(effector.matrixWorld);
      _effectorVec.subVectors(_effectorPos, _linkPos).applyQuaternion(_invLinkQ);
      if (_effectorVec.lengthSq() < 1e-10) continue;
      _effectorVec.normalize();

      _targetVec.subVectors(_targetPos, _linkPos).applyQuaternion(_invLinkQ);
      if (_targetVec.lengthSq() < 1e-10) continue;
      _targetVec.normalize();

      let angle = THREE.MathUtils.clamp(_targetVec.dot(_effectorVec), -1, 1);
      angle = Math.acos(angle);
      if (angle < 1e-5) continue;
      if (angle > maxAngle) angle = maxAngle;

      _axis.crossVectors(_effectorVec, _targetVec);
      if (_axis.lengthSq() < 1e-10) continue;
      _axis.normalize();

      _quat.setFromAxisAngle(_axis, angle);
      if (blend < 0.999) {
        _id.identity();
        _quatBlend.slerpQuaternions(_id, _quat, blend);
        link.quaternion.multiply(_quatBlend);
      } else {
        link.quaternion.multiply(_quat);
      }
      link.updateMatrixWorld(true);
    }
  }
}

function bone(bones, side, part) {
  return (
    bones[`${side}${part}`] ||
    bones[`mixamorig:${side}${part}`] ||
    bones[`mixamorig${side}${part}`] ||
    null
  );
}

function biasElbow(arm, fore, hand, side, strength = 0.35) {
  if (!arm || !fore || !hand || strength <= 0) return;
  arm.parent?.updateWorldMatrix(true, false);
  arm.updateWorldMatrix(false, false);
  fore.updateWorldMatrix(false, false);
  hand.updateWorldMatrix(false, false);

  arm.getWorldPosition(_shoulderPos);
  fore.getWorldPosition(_elbowPos);
  hand.getWorldPosition(_handPos);

  _mid.lerpVectors(_shoulderPos, _handPos, 0.5);
  _boneUp.set(0, 1, 0);
  _toElbow.subVectors(_handPos, _shoulderPos);
  if (_toElbow.lengthSq() < 1e-8) return;
  _toElbow.normalize();
  _pole.crossVectors(_toElbow, _boneUp);
  if (_pole.lengthSq() < 1e-8) _pole.set(side === 'Right' ? 1 : -1, 0, 0);
  else _pole.normalize();
  if (side === 'Left') _pole.negate();
  _pole.multiplyScalar(70).add(_mid);
  if (side === 'Right') _pole.y += 14;
  else _pole.y -= 18;

  arm.matrixWorld.decompose(_linkPos, _invLinkQ, _linkScale);
  _invLinkQ.invert();
  _toElbow.subVectors(_elbowPos, _linkPos).applyQuaternion(_invLinkQ);
  if (_toElbow.lengthSq() < 1e-10) return;
  _toElbow.normalize();
  _toPole.subVectors(_pole, _linkPos).applyQuaternion(_invLinkQ);
  if (_toPole.lengthSq() < 1e-10) return;
  _toPole.normalize();

  let angle = THREE.MathUtils.clamp(_toPole.dot(_toElbow), -1, 1);
  angle = Math.acos(angle) * strength;
  if (angle < 1e-4) return;
  _axis.crossVectors(_toElbow, _toPole);
  if (_axis.lengthSq() < 1e-10) return;
  _axis.normalize();
  _quat.setFromAxisAngle(_axis, Math.min(angle, 0.4));
  arm.quaternion.multiply(_quat);
  arm.updateMatrixWorld(true);
}

/**
 * Gira la mano para que la palma mire al cuerpo del arma (sin romper el wrist del CCD).
 * En este Mixamo: prueba ejes locales −Z / +X como normal de palma.
 */
function softenPalmToGun(hand, side, gunCenter, weight = 0.55) {
  if (!hand?.parent || weight <= 0) return;
  hand.parent.updateWorldMatrix(true, false);
  hand.updateWorldMatrix(false, false);
  hand.getWorldPosition(_handPos);
  _toGun.subVectors(gunCenter, _handPos);
  if (_toGun.lengthSq() < 1e-8) return;
  _toGun.normalize();

  hand.getWorldQuaternion(_qWorld);
  // Candidatos de “palma hacia fuera” en local → mundo
  const candidates = [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0)
  ];
  let best = candidates[0].clone().applyQuaternion(_qWorld);
  let bestDot = -2;
  for (const c of candidates) {
    const w = c.clone().applyQuaternion(_qWorld);
    // Queremos que la palma apunte HACIA el arma
    const d = w.dot(_toGun);
    if (d > bestDot) {
      bestDot = d;
      best.copy(w);
    }
  }
  if (bestDot > 0.92) return; // ya mira bastante bien

  _qDelta.setFromUnitVectors(best.normalize(), _toGun);
  // Limitar rotación de muñeca
  const ang = 2 * Math.acos(THREE.MathUtils.clamp(_qDelta.w, -1, 1));
  if (ang > 0.9) {
    _qDelta.slerp(_id.identity(), 1 - 0.9 / ang);
  }

  _qWorld.premultiply(_qDelta);
  hand.parent.getWorldQuaternion(_qParent);
  _qLocal.copy(_qParent).invert().multiply(_qWorld);
  hand.quaternion.slerp(_qLocal, weight);
  hand.updateWorldMatrix(true, false);
}

/**
 * @param {object} bones
 * @param {'Left'|'Right'} side
 * @param {THREE.Vector3} targetWorld
 * @param {object|null} weaponAxes
 * @param {number} blend
 */
export function solveArmToTarget(bones, side, targetWorld, weaponAxes = null, blend = 1) {
  const shoulder = bone(bones, side, 'Shoulder');
  const arm = bone(bones, side, 'Arm');
  const fore = bone(bones, side, 'ForeArm');
  const hand = bone(bones, side, 'Hand');
  if (!arm || !fore || !hand) return;

  const rootBone = shoulder || arm;
  rootBone.parent?.updateWorldMatrix(true, false);
  rootBone.updateWorldMatrix(false, true);

  (shoulder || arm).getWorldPosition(_shoulderPos);
  arm.getWorldPosition(_pArm);
  fore.getWorldPosition(_pFore);
  hand.getWorldPosition(_handPos);

  const maxReach =
    (shoulder ? _shoulderPos.distanceTo(_pArm) : 0) +
    _pArm.distanceTo(_pFore) +
    _pFore.distanceTo(_handPos);

  _targetPos.copy(targetWorld);
  const need = _shoulderPos.distanceTo(_targetPos);
  // Dejar codo flexionado (~85% reach)
  const reachLimit = Math.max(maxReach * 0.85, 1);
  if (need > reachLimit) {
    _targetPos.lerpVectors(_shoulderPos, targetWorld, reachLimit / need);
  }

  const links = [fore, arm];
  if (shoulder) links.push(shoulder);

  solveCcdIk({
    links,
    effector: hand,
    targetWorld: _targetPos,
    iteration: 28,
    maxAngle: 0.75,
    blend: blend >= 0.999 ? 1 : blend
  });

  biasElbow(arm, fore, hand, side, 0.5);
  solveCcdIk({
    links: [fore, arm],
    effector: hand,
    targetWorld: _targetPos,
    iteration: 18,
    maxAngle: 0.6,
    blend: blend >= 0.999 ? 1 : blend
  });

  // Centro del arma ≈ grip + un poco hacia el cañón
  if (weaponAxes?.forward) {
    _mid.copy(_targetPos).addScaledVector(weaponAxes.forward, side === 'Right' ? 4 : 8);
    softenPalmToGun(hand, side, _mid, 0.22);
  }
}

export function weaponAxesFromMount(mount) {
  if (!mount) return null;
  mount.updateWorldMatrix(true, false);
  const q = new THREE.Quaternion();
  mount.getWorldQuaternion(q);
  return {
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize(),
    forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize()
  };
}
