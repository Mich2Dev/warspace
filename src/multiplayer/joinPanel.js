import {

    defaultMultiplayerUrl,

    loadCallsignFromProfile,

    saveMultiplayerPrefs,

} from './MultiplayerClient.js';



function suggestNick() {

    const saved = loadCallsignFromProfile();

    if (saved && saved !== 'Piloto') return saved;

    return `Piloto-${100 + Math.floor(Math.random() * 900)}`;

}



/** Panel: nick + entrar a la sala compartida. */

export function initJoinPanel(onEnter) {

    const panel = document.getElementById('multiplayer-join');

    const nickInput = document.getElementById('mp-nick-input');

    const joinBtn = document.getElementById('mp-join-btn');



    if (!panel) {

        onEnter({ nick: suggestNick(), serverUrl: defaultMultiplayerUrl() });

        return;

    }



    panel.classList.remove('hidden');

    if (nickInput) nickInput.value = suggestNick();



    let resolved = false;

    let loadReady = false;



    const finish = (opts) => {

        if (resolved) return;

        resolved = true;

        panel.classList.add('hidden');

        onEnter(opts);

    };



    const getNick = () => (nickInput?.value || suggestNick()).trim().slice(0, 18) || suggestNick();



    const enterRoom = () => {

        if (!loadReady) return;

        const nick = getNick();

        saveMultiplayerPrefs({ nick });

        finish({

            nick,

            serverUrl: defaultMultiplayerUrl(),

        });

    };



    joinBtn?.addEventListener('click', enterRoom);



    nickInput?.addEventListener('keydown', (e) => {

        if (e.key === 'Enter' && loadReady) enterRoom();

    });



    return {

        markLoadReady() {

            loadReady = true;

            if (joinBtn) joinBtn.disabled = false;

            const hint = document.getElementById('mp-load-hint');

            if (hint) hint.textContent = 'Mapa listo — entra a la sala cuando quieras';

        },

    };

}



export function updateMultiplayerHud(client, remoteCount, syncEnemyCount = null) {

    const el = document.getElementById('mp-online-chip');

    if (!el) return;

    if (!client?.isOnline) {

        el.hidden = true;

        return;

    }

    el.hidden = false;

    const role = client.isHost ? 'HOST' : 'INVITADO';

    const total = client.playerCount || (remoteCount + 1);

    let line = `${client.roomName || 'Sala'} · ${role} · ${total} piloto(s)`;

    if (!client.isHost) {

        if (syncEnemyCount != null && syncEnemyCount > 0) {

            line += ` · ${syncEnemyCount} bichos sync`;

        } else if (syncEnemyCount != null && syncEnemyCount === 0) {

            line += ' · esperando sync…';

        } else {

            line += ' · sync bichos…';

        }

    } else if (syncEnemyCount != null) {

        line += ` · ${syncEnemyCount} bichos`;

    }

    el.textContent = line;

    el.classList.toggle('mp-role-host', client.isHost);

    el.classList.toggle('mp-role-guest', !client.isHost);

}

