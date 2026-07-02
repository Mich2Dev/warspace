/** Contratos de evento — solo se activan si el jugador los acepta en el Tablero (E). */
export const EVENT_CONTRACTS = [
    {
        id: 'evt_invasion',
        type: 'invasion',
        title: 'Invasion Hostil',
        shortLabel: 'INVASION',
        description: 'Escuadrones Invader_* atacan un sector. Elimina oleadas antes de que expire el tiempo.',
        objective: 'Derriba unidades de invasion en el sector asignado.',
        minLevel: 1,
        cooldownSec: 150,
        rewardCredits: 650,
        icon: '⚠',
        color: '#ff6644',
    },
    {
        id: 'evt_distress',
        type: 'distress',
        title: 'Senal de Auxilio',
        shortLabel: 'AUXILIO',
        description: 'Intercepta una transmision de socorro, llega al punto y defiende la zona.',
        objective: 'Alcanza la baliza y sobrevive a las oleadas defensivas.',
        minLevel: 2,
        cooldownSec: 180,
        rewardCredits: 520,
        icon: '◎',
        color: '#7fe4ff',
    },
    {
        id: 'evt_miniboss',
        type: 'miniBoss',
        title: 'Caza al Nemesis',
        shortLabel: 'MINI-JEFE',
        description: 'Un comandante enemigo de elite entra al sector. Derrotarlo antes de que escape.',
        objective: 'Elimina al mini-jefe del evento.',
        minLevel: 3,
        cooldownSec: 240,
        rewardCredits: 900,
        icon: '⬡',
        color: '#cc88ff',
    },
];

export function getEventContractById(id) {
    return EVENT_CONTRACTS.find(c => c.id === id) || null;
}

export function getEventContractByType(type) {
    return EVENT_CONTRACTS.find(c => c.type === type) || null;
}
