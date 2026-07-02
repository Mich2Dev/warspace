/** Sincroniza misiones y eventos de sala — solo el HOST publica. */
export class RoomSync {
    constructor(game) {
        this.game = game;
        this._eventSyncTimer = 0;
    }

    _isHost() {
        const mp = this.game.multiplayerClient;
        return mp?.isOnline && mp.isHost;
    }

    emit(kind, payload) {
        if (!this._isHost()) return;
        this.game.multiplayerClient?.sendEvent(kind, payload);
    }

    handle(_from, kind, payload) {
        if (kind === 'room_mission') {
            this.game.missionManager?.applyRoomMission(payload);
        } else if (kind === 'room_event') {
            this.game.eventDirector?.applyRoomEvent(payload);
        }
    }

    update(delta) {
        if (!this._isHost()) return;
        const ed = this.game.eventDirector;
        if (!ed?.activeEvent) return;
        this._eventSyncTimer -= delta;
        if (this._eventSyncTimer > 0) return;
        this._eventSyncTimer = 0.5;
        this.emit('room_event', {
            action: 'sync',
            contractId: ed.activeEvent.contractId ?? null,
            event: this._serializeEvent(ed.activeEvent),
        });
    }

    broadcastMissionStart(index) {
        this.emit('room_mission', { action: 'start', index, currentKills: 0 });
    }

    broadcastMissionKill(index, currentKills, enemyType, enemyName, details) {
        this.emit('room_mission', {
            action: 'kill',
            index,
            currentKills,
            enemyType,
            enemyName,
            details: {
                crDrop: details?.crDrop ?? 0,
                xpDrop: details?.xpDrop ?? 0,
                enemyTier: details?.enemyTier ?? 1,
            },
        });
    }

    broadcastMissionComplete(index, nextIndex, reward) {
        this.emit('room_mission', {
            action: 'complete',
            index,
            nextIndex,
            reward,
        });
    }

    /** Reenvía misión/evento activos a quien acaba de entrar. */
    pushStateForLateJoin() {
        if (!this._isHost()) return;
        const mm = this.game.missionManager;
        if (mm?.activeMissionIndex >= 0) {
            const idx = mm.activeMissionIndex;
            const m = mm.missions[idx];
            this.emit('room_mission', {
                action: 'sync',
                index: idx,
                currentKills: m?.currentKills ?? 0,
            });
        }
        const ed = this.game.eventDirector;
        if (ed?.activeEvent) {
            this.emit('room_event', {
                action: 'start',
                contractId: ed.activeEvent.contractId ?? null,
                event: this._serializeEvent(ed.activeEvent),
            });
        }
    }

    broadcastEventStart(contractId, event) {
        this.emit('room_event', {
            action: 'start',
            contractId,
            event: this._serializeEvent(event),
        });
    }

    broadcastEventEnd(contractId, success, reward = 0) {
        this.emit('room_event', { action: 'end', contractId, success: !!success, reward });
    }

    _serializeEvent(ev) {
        if (!ev) return null;
        const copy = { ...ev };
        if (copy.boss) {
            copy.bossHp = copy.boss.userData?.hp ?? 0;
            copy.bossMaxHp = copy.boss.userData?.maxHp ?? 1;
            delete copy.boss;
        }
        if (copy.distressPos && typeof copy.distressPos.x === 'number') {
            const p = copy.distressPos;
            copy.distressPos = { x: p.x, y: p.y ?? 0, z: p.z ?? 0 };
        }
        return copy;
    }
}
