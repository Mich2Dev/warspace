/**
 * Fuente única de verdad para VFX de habilidades del jugador.
 * Nada se muestra salvo escudo (4) o reparación (3) con canal activo real.
 */

export function isPlayerShieldUp(player) {
    return !!(
        player?.shieldActive
        && (player.shieldTimer ?? 0) > 0
        && (player.shieldHp ?? 0) > 0
    );
}

export function isPlayerRepairChannelUp(player) {
    const now = player?.time || 0;
    return (
        (player._repairChannelUntil ?? 0) > now
        && (player._repairChannelRate ?? 0) > 0
    );
}

/** Apaga flags y mallas al morir, respawn o inicio de sesión. */
export function resetPlayerAbilityState(player, vfx) {
    if (!player) return;
    player.shieldActive = false;
    player.shieldHp = 0;
    player.shieldTimer = 0;
    player._repairChannelUntil = 0;
    player._repairChannelRate = 0;
    player._repairChannelAccum = 0;
    player._repairKeyPulse = 0;
    player._shieldKeyPulse = 0;
    syncPlayerAbilityVisuals(player, vfx, 0);
}

/** Llamar cada frame desde Player.update — enforcement estricto. */
export function syncPlayerAbilityVisuals(player, vfx, delta = 0) {
    if (!player) return;

    const shieldUp = isPlayerShieldUp(player);
    const repairUp = isPlayerRepairChannelUp(player);

    if (player.shieldMesh) {
        player.shieldMesh.visible = shieldUp;
        if (shieldUp) {
            const maxShield = player.shieldMax || player._getShieldStats?.().shieldHp || 1;
            const ratio = maxShield > 0 ? Math.max(0, (player.shieldHp ?? 0) / maxShield) : 1;
            const pulse = 0.3 + 0.1 * Math.sin((player.time || 0) * 4.2);
            if (player.shieldShell?.material) {
                player.shieldShell.material.opacity = pulse * (0.45 + ratio * 0.55);
            }
            if (player.shieldShell) {
                player.shieldShell.rotation.y += delta * 0.4;
            }
        }
    }

    if (player.repairGlow?.material) {
        player.repairGlow.visible = repairUp;
        if (repairUp) {
            player._fitShieldScale?.();
            const pulse = 0.2 + 0.12 * Math.sin((player.time || 0) * 5.5);
            player.repairGlow.material.opacity = pulse;
            player.repairGlow.rotation.y = (player.time || 0) * 0.55;
        } else {
            player.repairGlow.material.opacity = 0;
        }
    }

    if (vfx) {
        if (repairUp) {
            vfx.setPlayerRepairActive(player, true, 'active');
        } else {
            vfx.setPlayerRepairActive(player, false);
        }
        vfx.clearPlayerShieldField?.();
    }
}
