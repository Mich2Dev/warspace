import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Environment } from './Environment.js';
import { CONFIG } from '../config.js';
import { Player } from './Player.js';
import { EnemyManager } from './EnemyManager.js';
import { MissionManager } from './MissionManager.js';
import { EventDirector } from './EventDirector.js';
import { EventBoard } from './EventBoard.js';
import { initProfile, toggleProfileModal, isDevRole, scheduleWalletSave, applyShipProfileToPlayer } from './profile.js';
import { initHangar, toggleHangar } from './hangar.js';
import {
    initSettings,
    toggleSettings,
    applySettings,
    applyLayout,
    updateSliderLabel,
    resetSettings,
    tickFps,
    getLastFps,
    applyUiMode,
} from './settings.js';
import { initUpgrades, toggleUpgrades } from './upgrades.js';
import { initArmory, toggleArmory } from './armory.js';
import { initCraft, toggleCraft } from './craft.js';
import { LootManager } from './LootManager.js';
import { WorldDirector } from './WorldDirector.js';
import planet01 from '../data/planet_01.json';
import { syncCombatConfig } from './balance.js';
import { syncSpawnerZonesFromPlanet } from './WorldDirector.js';
import { initMobileControls, isMobileLayout, syncMobileLayout, configureControlsForDesktop } from './mobileControls.js';
import { openModalById, closeModalById, toggleModalById } from './ui/UiAnimator.js';
import { wireGameModals } from './ui/gameModals.js';
import { getViewportSize, mapClientToLandscape, isForcedLandscape } from './orientationLock.js';
import { loadControlState, shouldUseMobileLayout, getControlState } from './controlSettings.js';
import { NavMarkerManager, pickGroundPoint } from './navMarker.js';
import { WorldHudManager, projectWorldToScreen } from './worldHud.js';
import { VfxManager } from './effects/VfxManager.js';
import { resetPlayerAbilityState } from './player/syncPlayerAbilityVisuals.js';
import {
    initGraphicsQuality,
    applyGraphicsQuality,
    loadSavedGraphicsQuality,
    tickGraphicsAutoScale,
} from './graphicsQuality.js';
import { initPerfBudget, tickPerfBudget } from './perfBudget.js';
import { MultiplayerClient } from './multiplayer/MultiplayerClient.js';
import { RemotePlayers } from './multiplayer/RemotePlayers.js';
import { initJoinPanel, updateMultiplayerHud } from './multiplayer/joinPanel.js';
import { CombatSync } from './multiplayer/CombatSync.js';
import { RoomSync } from './multiplayer/RoomSync.js';
import { GalaxyDirector } from './galaxy/GalaxyDirector.js';
import { PointerLock } from './galaxy/PointerLock.js';

// Expose to global scope (called from HTML onclick)
window.toggleSettings    = toggleSettings;
window.applySettings     = applySettings;
window.applyLayout       = applyLayout;
window.updateSliderLabel = updateSliderLabel;
window.resetSettings     = resetSettings;
window.applyUiMode       = applyUiMode;
window.toggleUpgrades    = toggleUpgrades;
window.toggleArmory      = toggleArmory;
window.toggleShop        = toggleArmory;
window.toggleCraft       = toggleCraft;
window.toggleProfile     = toggleProfileModal;
window.toggleEventBoard  = () => window.__eventBoard?.toggleBoard();

/** Instancia del juego — expuesta tras init para botones del HUD. */
let _gameInstance = null;
window.toggleMissionBoard = () => _gameInstance?._toggleModal('mission-board-modal');
window.toggleHangar       = () => _gameInstance?.toggleHangarModal?.() ?? toggleHangar();

window.onerror = function(msg, url, line, col, error) {
    const errorDiv = document.createElement('div');
    errorDiv.style.position = 'absolute';
    errorDiv.style.top = '10%';
    errorDiv.style.left = '10%';
    errorDiv.style.color = 'red';
    errorDiv.style.backgroundColor = 'rgba(0,0,0,0.8)';
    errorDiv.style.padding = '20px';
    errorDiv.style.zIndex = '9999';
    errorDiv.innerHTML = `<h2>CRASH:</h2><p>${msg}</p><p>Line: ${line}</p><p>${error ? error.stack : ''}</p>`;
    document.body.appendChild(errorDiv);
};

class Game {
    constructor() {
        this.init();
    }

    init() {
        this.loadingManager = new THREE.LoadingManager();
        this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const progress = (itemsLoaded / itemsTotal) * 100;
            const bar = document.getElementById('loading-bar');
            const text = document.getElementById('loading-text');
            if (bar) bar.style.width = progress + '%';
            let phase = 'mapa y nave';
            if (url.includes('/patrols/')) phase = 'patrullas';
            else if (url.includes('/zona') || url.includes('/enemis_')) phase = 'enemigos';
            if (text) text.innerText = `Cargando ${phase}: ${Math.round(progress)}%`;
        };
        this.loadingManager.onError = (url) => {
            console.warn('[WarSpace] Recurso no cargado:', url);
        };
        this.loadingManager.onLoad = () => {
            this._assetsLoaded = true;
            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        this.renderer.compile(this.scene, this.camera);
                    } catch (_) { /* ignore */ }
                }, 150);
            });
            this._joinPanelCtrl?.markLoadReady();
        };

        // Pantalla de carga: nave, terreno, patrullas y enemigos (evita mundo vacío al entrar)
        this.gltfLoader = new GLTFLoader(this.loadingManager);
        this.enemyGltfLoader = new GLTFLoader(this.loadingManager);

        this.scene = new THREE.Scene();
        // Cielo azul arriba; niebla azul-gris en distancia (separación cielo/tierra)
        this.scene.background = new THREE.Color(0x5890b8);
        this.scene.fog = new THREE.Fog(0xb8ccd8, 900, 10500);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.8, 26000);

        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();

        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true,
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
        this.renderer.shadowMap.enabled = !!CONFIG.GRAPHICS.ENABLE_SHADOWS;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.body.appendChild(this.renderer.domElement);

        // Post-Processing (Brillo/Resplandor Neón)
        const renderScene = new RenderPass(this.scene, this.camera);
        
        // Ajustamos el Bloom con los valores de config.js para reducir la ceguera del sol
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            CONFIG.GRAPHICS.BLOOM_INTENSITY, // strength (antes 1.5)
            0.28, // radius
            CONFIG.GRAPHICS.BLOOM_THRESHOLD // threshold (antes 0.85)
        );

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(renderScene);
        this.composer.addPass(this.bloomPass);
        this._useBloom = false;

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; 
        this.controls.minDistance = 20;
        // Limitado a 1500 (una reducción significativa) para evitar el "modo satélite"
        // donde se rompe la inmersión al ver cortes de agua feos y la hierba desaparece.
        this.controls.maxDistance = 1500; 
        
        // Pirate Galaxy style: Right click rotates camera, Left click targets
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.NONE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
        };
        this.controls.enablePan = false;
        this.controls.rotateSpeed = 0.45;
        this.controls.addEventListener('start', () => {
            this.player?.markCameraManualOverride();
        });
        loadControlState();
        configureControlsForDesktop(this.controls);
        // La cámara inicial es controlada por el Player, así que asignamos el target
        this.controls.target.set(0, 50, 4000);

        window.addEventListener('mousemove', (e) => {
            const { width, height } = getViewportSize();
            let x = e.clientX;
            let y = e.clientY;
            if (isForcedLandscape()) {
                ({ x, y } = mapClientToLandscape(x, y));
            }
            this.mouse.x = (x / width) * 2 - 1;
            this.mouse.y = -(y / height) * 2 + 1;
        });

        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('viewport-resize', this.onWindowResize.bind(this));
        window.addEventListener('pointerdown', this.onPointerDown.bind(this));
        window.addEventListener('pointermove', this.onPointerMove.bind(this));
        window.addEventListener('touchend', this.onTouchTap.bind(this), { passive: true });
        
        // Evitar el menú contextual al hacer clic derecho para rotar cámara
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        this.environment = new Environment(this.scene, this.loadingManager);
        this.player = new Player(this.scene, this.camera, this.gltfLoader);
        this.navMarker = new NavMarkerManager(this.scene);
        this.worldHud = new WorldHudManager();
        this.vfx = new VfxManager(this.scene);
        this.player.navMarker = this.navMarker;
        window.__navMarker = this.navMarker;
        syncCombatConfig(CONFIG, 'planet_01', 1);
        syncSpawnerZonesFromPlanet(CONFIG, planet01);
        this.enemyManager = new EnemyManager(this.scene, this.player, this.enemyGltfLoader);
        this.enemyManager.setEnvironment(this.environment);
        this.enemyManager.setGameRef(this);
        this.enemyManager.setVfx(this.vfx);
        this.worldDirector = new WorldDirector(this.enemyManager, CONFIG);
        this.player.planetId = this.worldDirector.planetId;
        this.lootManager = new LootManager(this.player);
        this.missionManager = new MissionManager(this.player, this.enemyManager);
        this.eventDirector = new EventDirector(this.player, this.enemyManager, this.scene);
        this.eventBoard = new EventBoard(this.eventDirector, this.player);
        window.__eventBoard = this.eventBoard;

        this.galaxy = new GalaxyDirector({
            scene: this.scene,
            camera: this.camera,
            environment: this.environment,
            player: this.player,
            controls: this.controls,
        });
        this.galaxy.initHud();
        this._pointerLock = new PointerLock(this.renderer.domElement);
        this.renderer.domElement.addEventListener('click', () => {
            if (this._sessionActive && this.galaxy?.wantsPointerLock?.()) {
                this._pointerLock.tryLock(this.galaxy);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._pointerLock?.unlock?.();
        });

        initProfile(this.player);
        applyShipProfileToPlayer(this.player);
        initHangar(this.player);

        this.multiplayerClient = null;
        this.remotePlayers = null;
        this._joinPanelCtrl = initJoinPanel((opts) => this._beginSession(opts));

        // Conectar sistemas con las muertes de enemigos
        this.enemyManager.onEnemyKilled = (enemyType, enemyName, details) => {
            const drops = this.lootManager.onEnemyKilled(enemyType, {
                isPatrol: details?.isPatrol,
                patrolRole: details?.patrolRole || null,
            });
            if (drops.length) {
                const msg = this.lootManager.formatDropMessage(drops);
                const log = document.getElementById('log-text');
                if (log && msg) {
                    log.innerHTML = `<span style="color:#88ffcc;font-weight:bold;">Botín: ${msg}</span>`;
                }
            }
            this.missionManager.onEnemyKilled(enemyType, enemyName, details || {});
            this.eventDirector.onEnemyKilled(enemyType, enemyName, details);
        };

        // Patrullas y enemigos se activan al entrar en sesión (_beginSession), no durante la carga.

        // Targeting System (already initialized above)

        // Minimap Navigation
        const minimap = document.getElementById('minimap');
        if (minimap) {
            const toggleMinimapSize = () => {
                minimap.classList.toggle('maximized');
                const btn = document.getElementById('minimap-size-toggle');
                if (btn) {
                    const isMax = minimap.classList.contains('maximized');
                    btn.title = isMax ? 'Reducir mapa' : 'Ampliar mapa';
                    btn.textContent = isMax ? '−' : '+';
                    btn.setAttribute('aria-label', btn.title);
                }
            };
            const minimapToggleBtn = document.getElementById('minimap-size-toggle');
            if (minimapToggleBtn) {
                minimapToggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    toggleMinimapSize();
                });
            }
            minimap.addEventListener('dblclick', (e) => {
                if (e.target && e.target.id === 'minimap-size-toggle') return;
                e.preventDefault();
                toggleMinimapSize();
            });

            minimap.addEventListener('click', (e) => {
                if (e.target && e.target.id === 'minimap-size-toggle') return;
                const rect = minimap.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const worldX = (x / rect.width) * 24000 - 12000;
                const worldZ = (y / rect.height) * 24000 - 12000;
                this.player.setNavDestination(new THREE.Vector3(worldX, 0, worldZ));
            });
        }

        // UI Modal Listeners
        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (k === 'j') this._toggleModal('mission-board-modal');
            if (k === 'h') this.toggleHangarModal();
            if (k === 'e') this.eventBoard?.toggleBoard();
            if (k === 'p') toggleProfileModal();
            if (k === 'k' && isDevRole() && this.eventDirector && !this.eventDirector.activeEvent) {
                this.eventDirector.startInvasionEvent({ contractId: 'evt_invasion' });
            }
            if (k === 'l' && isDevRole() && this.eventDirector && !this.eventDirector.activeEvent) {
                this.eventDirector.startDistressEvent({ contractId: 'evt_distress' });
            }
            if (k === 'm' && isDevRole() && this.eventDirector && !this.eventDirector.activeEvent) {
                this.eventDirector.startMiniBossEvent({ contractId: 'evt_miniboss' });
            }
        });

        wireGameModals(this);

        // Hangar de naves — initHangar() en hangar.js

        this.clock = new THREE.Clock();
        this._frame = 0;
        this._sessionActive = false;
        this._assetsLoaded = false;
        this._animateBound = this.animate.bind(this);
        this._navCamDir = new THREE.Vector3();

        // Init settings panel once Three.js objects are ready
        initSettings({
            bloomPass: this.bloomPass,
            fog: this.scene.fog,
            controls: this.controls,
            domElement: this.renderer.domElement,
            syncMobileLayout,
        });
        initGraphicsQuality(this);
        initPerfBudget(this);
        applyGraphicsQuality(loadSavedGraphicsQuality());
        initUpgrades(this.player);
        initArmory(this.player);
        initCraft(this.player);

        initMobileControls(this.player, {
            getEnemyManager: () => this.enemyManager,
            getControls: () => this.controls,
            toggleHangar: () => this.toggleHangarModal(),
            openMissions: () => this._toggleModal('mission-board-modal'),
            openEvents: () => window.__eventBoard?.toggleBoard(),
            openArmory: () => toggleArmory(),
            openShop: () => toggleArmory(),
            openUpgrades: () => toggleUpgrades(),
            openProfile: () => toggleProfileModal(),
            openSettings: () => toggleSettings(),
        });

        this.onWindowResize();

        window.__syncHudLayout = () => this.updateHudSafeLayout();

        this._touchStarts = new Map();
        window.addEventListener('touchstart', (e) => {
            for (const t of e.changedTouches) {
                this._touchStarts.set(t.identifier, { x: t.clientX, y: t.clientY });
            }
        }, { passive: true });

        this.animate();
    }

    _beginSession(opts) {
        const screen = document.getElementById('loading-screen');
        const ui = document.getElementById('ui');
        if (screen) screen.style.display = 'none';
        if (ui) ui.style.display = 'flex';

        this._sessionActive = true;
        this.environment?.setSessionActive(true);
        this.environment?.resetSurfacePresentation?.(this.scene);
        this.galaxy?.showSurfaceHint?.();
        this.worldDirector.bootstrap(this.environment);

        const callsignEl = document.getElementById('pilot-callsign');
        if (callsignEl && opts.nick) callsignEl.textContent = opts.nick;

        const log = document.getElementById('log-text');
        this._appliedMpRole = 'solo';
        resetPlayerAbilityState(this.player, this.vfx);

        if (log) log.textContent = 'Conectando a la sala…';
        this._setupMultiplayer(opts);
    }

    _setupMultiplayer(opts) {
        this.combatSync = new CombatSync(this);
        this.roomSync = new RoomSync(this);
        this.remotePlayers = new RemotePlayers(this.scene, this.environment, this.gltfLoader);
        this._worldSyncTimer = 0;
        this._appliedMpRole = 'solo';

        this.multiplayerClient = new MultiplayerClient({
            onWelcome: (msg) => {
                this._ensureMpRoleSynced(true);
                if (msg.spawn) {
                    this._mpSpawn = { x: msg.spawn.x, y: msg.spawn.y, z: msg.spawn.z };
                    this.player.mpSpawn = this._mpSpawn;
                    this.player.position.set(msg.spawn.x, msg.spawn.y, msg.spawn.z);
                    if (this.player.mesh) this.player.mesh.position.copy(this.player.position);
                }
                if (this.multiplayerClient.isHost) {
                    this.enemyManager._ensureHostWorld(true);
                    requestAnimationFrame(() => this._pushWorldSync());
                    setTimeout(() => this._pushWorldSync(), 400);
                    setTimeout(() => this._pushWorldSync(), 1200);
                }
                const n = msg.playerCount ?? (this.remotePlayers?.count() ?? 0) + 1;
                this._refreshMpStatus(
                    this.multiplayerClient.isHost
                        ? `Sala · ${n} piloto(s) · tú controlas los bichos`
                        : `Sala · ${n} piloto(s) · sync bichos del host`,
                );
            },
            onSnapshot: (players) => {
                this._ensureMpRoleSynced();
                this._syncLocalPlayerFromServer(players);
                this.remotePlayers.applySnapshot(players, this.multiplayerClient.playerId);
                this._syncCombatTargets(players);
                this._refreshMpStatus();
            },
            onPlayerJoined: (player) => {
                this.remotePlayers.onPlayerJoined(player, this.multiplayerClient.playerId);
                if (this.multiplayerClient.isHost) {
                    this._pushWorldSync();
                    this.roomSync?.pushStateForLateJoin();
                    setTimeout(() => this._pushWorldSync(), 400);
                    setTimeout(() => this._pushWorldSync(), 1200);
                }
                this._refreshMpStatus(
                    this.multiplayerClient.isHost
                        ? `${player.nick} entró · bichos sincronizados con la sala`
                        : `${player.nick} en el mapa`,
                );
            },
            onPlayerLeft: (id, nick) => {
                if (this.player?.target?.userData?.playerId === id) {
                    this.player.setTarget(null);
                }
                this.remotePlayers.remove(id);
                if (nick) this.remotePlayers.removeByNick(nick);
                this.remotePlayers.purgeOrphanMeshes();
                this.remotePlayers.pruneOrphanTags();
                this._refreshMpStatus(
                    nick ? `${nick} abandonó el sector` : 'Un piloto abandonó el sector',
                );
            },
            onEvent: (from, kind, payload) => {
                if (kind === 'pvp_hit') {
                    this.combatSync.applyPvpHit(from, payload);
                    return;
                }
                if (kind === 'player_shoot') {
                    this.combatSync._remotePlayerShoot(from, payload);
                    return;
                }
                if (kind === 'player_missile') {
                    this.combatSync._remotePlayerMissile(from, payload);
                    return;
                }
                if (kind === 'enemy_damage' && this.multiplayerClient.isHost) {
                    this.enemyManager.applyGuestEnemyDamage(from, payload);
                    return;
                }
                if (kind === 'player_damage') {
                    this.combatSync.applyPlayerDamage(from, payload);
                    return;
                }
                if (kind === 'player_died') {
                    this.combatSync._applyPlayerDied(payload);
                    return;
                }
                if (kind === 'player_respawn') {
                    this.combatSync._applyPlayerRespawn(payload);
                    return;
                }
                if (kind === 'room_mission' || kind === 'room_event') {
                    this.roomSync.handle(from, kind, payload);
                    return;
                }
                this.combatSync.handle(from, kind, payload);
            },
            onWorldSync: (enemies) => {
                this.enemyManager.applyWorldSync(enemies);
                if (!this.multiplayerClient?.isHost) {
                    const n = enemies?.length ?? 0;
                    this._refreshMpStatus(
                        n > 0
                            ? `${n} bichos del host en tu mapa`
                            : 'esperando bichos del host…',
                    );
                }
            },
            onHostChanged: () => {
                this._ensureMpRoleSynced(true);
                if (!this.multiplayerClient.isHost) {
                    this.enemyManager.purgeAllSyncGhosts();
                }
                if (this.multiplayerClient.isHost) {
                    this._pushWorldSync();
                    this.roomSync?.pushStateForLateJoin();
                }
                this._refreshMpStatus(
                    this.multiplayerClient.isHost
                        ? 'Sala · ahora eres HOST'
                        : 'Sala · ahora eres INVITADO',
                );
            },
            onStatus: (state, msg) => {
                if (state === 'error' || state === 'reconnecting') {
                    const log = document.getElementById('log-text');
                    if (log) log.textContent = msg;
                }
            },
        });
        this.multiplayerClient.connect(opts.serverUrl, opts.nick);
    }

    _syncLocalPlayerFromServer(players) {
        const localId = this.multiplayerClient?.playerId;
        const pl = this.player;
        if (!localId || !pl) return;
        const me = (players || []).find((p) => String(p.id) === String(localId));
        if (!me || typeof me.hp !== 'number') return;

        if (me.hp <= 0) {
            if (!pl.isDead) {
                pl.hp = 0;
                pl.isDead = true;
                pl.die({ fromNetwork: true });
            }
            return;
        }

        if (pl.isDead && me.hp > 0) {
            pl.isDead = false;
            pl.hp = me.hp;
            if (pl.mesh) pl.mesh.visible = true;
            pl.updateUI();
            return;
        }

        if (pl.isDead) return;

        if (Math.abs(me.hp - pl.hp) > 0.5) {
            pl.hp = me.hp;
        }
        const localShieldUp = pl._isShieldUp?.() ?? (
            pl.shieldActive && (pl.shieldTimer ?? 0) > 0 && (pl.shieldHp ?? 0) > 0
        );
        if (localShieldUp) {
            // Autoridad local: no borrar el escudo con snapshot obsoleto (shieldHp=0 / shieldActive=false).
            if (
                typeof me.shieldHp === 'number'
                && me.shieldActive
                && me.shieldHp < (pl.shieldHp ?? 0) - 0.5
            ) {
                pl.shieldHp = me.shieldHp;
                if (pl.shieldHp <= 0) {
                    pl.shieldActive = false;
                    pl.shieldTimer = 0;
                    if (pl.shieldMesh) pl.shieldMesh.visible = false;
                }
            }
            pl._syncShieldVisual?.();
        } else if (
            me.shieldActive
            && typeof me.shieldHp === 'number'
            && me.shieldHp > 0
            && typeof me.shieldTimer === 'number'
            && me.shieldTimer > 0
        ) {
            pl.shieldActive = true;
            pl.shieldHp = me.shieldHp;
            pl.shieldTimer = me.shieldTimer;
            if (typeof me.shieldMax === 'number') pl.shieldMax = me.shieldMax;
            pl._syncShieldVisual?.();
        } else if (!localShieldUp) {
            pl.shieldActive = false;
            pl.shieldTimer = 0;
            pl.shieldHp = 0;
            pl._syncShieldVisual?.();
        }

        pl.updateUI();
    }

    _pushWorldSync() {
        if (!this.multiplayerClient?.isOnline) return;
        if (!this.multiplayerClient.isHost && this.enemyManager?._mpMode !== 'host') return;
        this.multiplayerClient.sendWorldSync(this.enemyManager.collectWorldSync());
    }

    _isMpWorldHost() {
        const c = this.multiplayerClient;
        if (!c?.isOnline) return false;
        return c.isHost || this.enemyManager?._mpMode === 'host';
    }

    _refreshMpStatus(eventLine = null) {
        const client = this.multiplayerClient;
        if (!client?.isOnline) return;
        const syncN = client.isHost
            ? (this.enemyManager?.collectWorldSync?.()?.length ?? 0)
            : (this.enemyManager?._syncGhosts?.size ?? 0);
        updateMultiplayerHud(client, this.remotePlayers?.count() ?? 0, syncN);
        if (!eventLine) return;
        const log = document.getElementById('log-text');
        if (!log) return;
        const role = client.isHost ? 'HOST' : 'INVITADO';
        log.textContent = `${role} — ${eventLine}`;
    }

    _ensureMpRoleSynced(force = false) {
        const client = this.multiplayerClient;
        if (!client?.isOnline) return;
        const mode = client.isHost ? 'host' : 'guest';
        if (!force && this._appliedMpRole === mode) return;
        const prev = this._appliedMpRole;
        this._appliedMpRole = mode;
        this.enemyManager.setMultiplayer(mode, this.combatSync);
        if (mode === 'host' && prev !== 'host') {
            this.enemyManager._ensureHostWorld(true);
            requestAnimationFrame(() => this._pushWorldSync());
        }
    }

    _applyMultiplayerRole(isHost) {
        const mode = isHost ? 'host' : 'guest';
        if (this._appliedMpRole === mode) return;
        this._appliedMpRole = mode;
        this.enemyManager.setMultiplayer(mode, this.combatSync);
    }

    _syncCombatTargets(players) {
        this.enemyManager.updateRemoteCombatTargets(players, this.multiplayerClient?.playerId);
        this._syncCombatTargetsFromRemotes();
    }

    _syncCombatTargetsFromRemotes() {
        if (!this.remotePlayers) return;
        for (const entry of this.remotePlayers.remote.values()) {
            const t = this.enemyManager._remoteCombatTargets.find((r) => r.id === entry.id);
            if (t) {
                t.pos.set(entry.display.x, entry.display.y, entry.display.z);
                t.hp = entry.hp ?? t.hp;
            }
        }
    }

    _openModal(id) {
        openModalById(id);
    }

    _closeModal(id) {
        closeModalById(id);
    }

    _toggleModal(id) {
        if (id === 'hangar-modal') {
            this.toggleHangarModal();
            return;
        }
        toggleModalById(id);
    }

    toggleHangarModal() {
        toggleHangar();
    }

    _pointerToNdc(event) {
        const { width, height } = getViewportSize();
        let x = event.clientX;
        let y = event.clientY;
        if (isForcedLandscape()) {
            ({ x, y } = mapClientToLandscape(x, y));
        }
        this.mouse.x = (x / width) * 2 - 1;
        this.mouse.y = -(y / height) * 2 + 1;
        return this.mouse.clone();
    }

    _isWorldInteraction(event) {
        if (event.target?.closest?.('#mobile-controls, .mobile-menu-sheet, .game-modal, #settings-panel, #system-menu, #minimap, .hud-panel, #action-bar, #combat-log, #credits-hud')) {
            return false;
        }
        return event.target === this.renderer.domElement;
    }

    onPointerMove(event) {
        if (isMobileLayout() || !this._isWorldInteraction(event)) {
            this.navMarker?.clearPreview();
            document.body.classList.remove('nav-cursor-active');
            return;
        }

        const cfg = getControlState();
        if (!cfg.clickToMove || !cfg.showNavPreview || cfg.navMarkerStyle === 'off') {
            this.navMarker?.clearPreview();
            document.body.classList.remove('nav-cursor-active');
            return;
        }

        if (event.buttons !== 0) return;

        const ndc = this._pointerToNdc(event);
        const point = pickGroundPoint(this.camera, ndc, this.environment);
        if (point) {
            this.navMarker.setPreview(point);
            document.body.classList.add('nav-cursor-active');
        } else {
            this.navMarker.clearPreview();
            document.body.classList.remove('nav-cursor-active');
        }
    }

    onTouchTap(event) {
        if (!isMobileLayout()) return;
        if (event.target?.closest?.('#mobile-controls, .mobile-menu-sheet, .game-modal, #minimap')) return;

        for (const t of event.changedTouches) {
            const start = this._touchStarts?.get(t.identifier);
            this._touchStarts?.delete(t.identifier);
            if (!start) continue;

            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            if (dx * dx + dy * dy > 625) continue;

            const { width: w, height: h } = getViewportSize();
            const { x, y } = isForcedLandscape()
                ? mapClientToLandscape(t.clientX, t.clientY)
                : { x: t.clientX, y: t.clientY };
            if (x < w * 0.5 && y > h * 0.22) continue;
            if (x > w * 0.54 && y > h * 0.36) continue;

            this.onPointerDown({
                clientX: t.clientX,
                clientY: t.clientY,
                button: 0,
                target: event.target,
            });
        }
    }

    onPointerDown(event) {
        if (!this._isWorldInteraction(event) && event.target?.closest?.('#mobile-controls, .mobile-menu-sheet, .game-modal')) return;
        if (isMobileLayout() && event.pointerType === 'touch') return;
        if (!this._isWorldInteraction(event)) return;

        const ndc = this._pointerToNdc(event);
        this.raycaster.setFromCamera(ndc, this.camera);

        if (this.multiplayerClient?.isOnline && this.remotePlayers) {
            const remoteMeshes = this.remotePlayers.getTargetableMeshes();
            if (remoteMeshes.length) {
                const remoteHits = this.raycaster.intersectObjects(remoteMeshes, true);
                if (remoteHits.length > 0) {
                    let object = remoteHits[0].object;
                    while (object.parent && !object.userData?.isRemotePlayer) {
                        object = object.parent;
                    }
                    if (object.userData?.isRemotePlayer) {
                        this.player.setTarget(object);
                        this.navMarker?.clearPreview();
                        return;
                    }
                }
            }
        }

        const intersects = this.raycaster.intersectObjects(this.enemyManager.enemies, true);

        if (intersects.length > 0) {
            let object = intersects[0].object;
            while (object.parent && !object.userData.isEnemy) {
                object = object.parent;
            }
            if (object.userData.isEnemy) {
                this.player.setTarget(object);
                this.navMarker?.clearPreview();
                return;
            }
        }

        const cfg = getControlState();
        if (event.button === 0 && cfg.clickToMove && !isMobileLayout()) {
            const point = pickGroundPoint(this.camera, ndc, this.environment);
            if (point) {
                this.player.setNavDestination(point);
                this.navMarker?.clearPreview();
                document.body.classList.remove('nav-cursor-active');
                return;
            }
        }
    }

    _syncGalaxyOrbitControls() {
        const block = !!(
            this.galaxy?.blocksOrbitControls?.()
            || this._pointerLock?.locked
            || this._pointerLock?.flightAimActive
        );
        if (!this.controls) return;
        this.controls.enabled = !block;
        if (block) {
            if (!this._orbitDomDetached) {
                try { this.controls.disconnect(); } catch (_) { /* ya desconectado */ }
                this._orbitDomDetached = true;
            }
        } else if (this._orbitDomDetached) {
            try { this.controls.connect(this.renderer.domElement); } catch (_) { /* noop */ }
            this._orbitDomDetached = false;
        }
    }

    onWindowResize() {
        const { width, height } = getViewportSize();
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        const mob = shouldUseMobileLayout();
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mob ? 1.0 : 1.2));
        this.renderer.setSize(width, height);
        this.composer.setSize(width, height);
        if (this.bloomPass?.setSize) {
            this.bloomPass.setSize(width, height);
        }
    }

    animate() {
        requestAnimationFrame(this._animateBound);

        let delta = this.clock.getDelta();
        this._frame = (this._frame ?? 0) + 1;

        // Evitar el "Tab Inactive Bug": Si cambias de pestaña, el navegador pausa el juego.
        // Al regresar, el delta puede ser altísimo (ej. 10 segundos).
        // Limitamos el delta a 0.1s para que el juego simplemente "pause" en vez de acelerar todo de golpe.
        if (delta > 0.1) delta = 0.1;

        if (!this._sessionActive) {
            this.environment?.updateBootPreview(this.player.position);
            this.controls?.update?.();
            tickFps();
            this.renderer.render(this.scene, this.camera);
            return;
        }

        this._syncGalaxyOrbitControls();

        if (this.galaxy?.isTransition?.()) {
            this.player.update(delta, this.enemyManager, this.environment, this.controls);
            this.galaxy.updateFlight(delta, this.player, this.environment, this.controls, this._pointerLock);
            this.galaxy.update(delta);
            this._syncGalaxyOrbitControls();
            if (!this.galaxy.blocksSurfaceSimulation?.()) {
                const usingNitro = !!(this.player.keys?.shift && this.player.energy > 0);
                this.camera.getWorldDirection(this._navCamDir);
                const viewDir = { x: this._navCamDir.x, z: this._navCamDir.z };
                this.environment.update(this.player.position, this.player.velocity, { nitro: usingNitro, viewDir });
            }
            tickFps();
            this.renderer.render(this.scene, this.camera);
            return;
        }

        if (this.multiplayerClient?.isOnline && this.remotePlayers) {
            this.remotePlayers.update(delta, this.camera);
        }

        this.player.update(delta, this.enemyManager, this.environment, this.controls);
        this.galaxy?.updateFlight(delta, this.player, this.environment, this.controls, this._pointerLock);
        this.galaxy?.update(delta);
        this._syncGalaxyOrbitControls();
        this.player._frame = this._frame;
        this.navMarker?.update(delta);

        if (this.multiplayerClient?.isOnline && this.remotePlayers) {
            this._syncCombatTargetsFromRemotes();
        }

        if (!this.galaxy?.blocksSurfaceSimulation?.()) {
            this.enemyManager.update(delta, this.environment);
        }
        this.vfx?.update(delta);
        const camShake = this.vfx?.getCameraShakeOffset?.();
        if (camShake) {
            this.camera.position.x += camShake.x;
            this.camera.position.y += camShake.y;
            this.camera.position.z += camShake.z;
        }
        this.combatSync?.update(delta);
        this.roomSync?.update(delta);
        this.eventDirector.update(delta);
        this.eventBoard?.update(delta);
        if (this.player?.isDead) {
            this.environment.update(this.player.position, new THREE.Vector3());
        } else if (!this.galaxy?.blocksSurfaceSimulation?.()) {
            const usingNitro = !!(this.player.keys?.shift && this.player.energy > 0 && !this.player.isDead);
            this.camera.getWorldDirection(this._navCamDir);
            const viewDir = { x: this._navCamDir.x, z: this._navCamDir.z };
            this.environment.update(this.player.position, this.player.velocity, { nitro: usingNitro, viewDir });
        }

        if (this._isMpWorldHost()) {
            this._worldSyncTimer = (this._worldSyncTimer || 0) + delta;
            const guestCount = Math.max(0, (this.multiplayerClient?.playerCount ?? 1) - 1);
            if (guestCount === 0) {
                this._worldSyncTimer = 0;
            } else {
                const combatPressure = this.enemyManager?.combatPressure ?? 0;
                const syncInterval = combatPressure >= 5 ? 0.4 : 0.25;
                if (this._worldSyncTimer >= syncInterval) {
                    this._worldSyncTimer = 0;
                    this.multiplayerClient.sendWorldSync(this.enemyManager.collectWorldSync());
                }
            }
            this._hostWorldWatchdog = (this._hostWorldWatchdog || 0) + delta;
            if (this._hostWorldWatchdog >= 2.5) {
                this._hostWorldWatchdog = 0;
                if (this.enemyManager._aliveMobileCount() < 5) {
                    this.enemyManager._ensureHostWorld(true);
                }
            }
        } else if (this.multiplayerClient?.isOnline && this.multiplayerClient.isHost
            && this.enemyManager?._mpMode !== 'host') {
            this._ensureMpRoleSynced(true);
        }

        if (this.multiplayerClient?.isOnline && this.player.mesh) {
            const q = this.player.mesh.quaternion;
            const shieldMax = this.player.equipment?.shield?.stats?.shieldHp ?? 0;
            const usingNitro = !!(this.player.keys?.shift && this.player.energy > 0 && !this.player.isDead);
            this.multiplayerClient.pushState({
                x: this.player.position.x,
                y: this.player.position.y,
                z: this.player.position.z,
                ry: this.player.mesh.rotation.y,
                qx: q.x,
                qy: q.y,
                qz: q.z,
                qw: q.w,
                roll: this.player.visualGroup?.rotation.z ?? 0,
                pitch: this.player.visualGroup?.rotation.x ?? 0,
                vx: this.player.velocity.x,
                vz: this.player.velocity.z,
                nitro: usingNitro,
                hp: this.player.hp,
                maxHp: this.player.maxHp,
                shieldActive: !!this.player._isShieldUp?.(),
                shieldHp: this.player.shieldHp ?? 0,
                shieldMax,
                shieldTimer: this.player.shieldTimer ?? 0,
            });
        }

        this.worldHud?.update(this.camera, this.player, delta, this.enemyManager);
        const pDot = document.getElementById('minimap-player');
        const orbitalRadar = !!this.galaxy?.usesOrbitalMinimap?.();
        if (pDot && !orbitalRadar && (this._frame % 2 === 0)) {
            const minimap = document.getElementById('minimap');
            const mapW = minimap ? minimap.clientWidth : 200;
            const mapH = minimap ? minimap.clientHeight : 200;
            // El mapa es de 24000x24000 (desde -12000 a +12000)
            const pX = (this.player.position.x + 12000) / 24000 * mapW;
            const pZ = (this.player.position.z + 12000) / 24000 * mapH;
            
            // Calcular hacia dónde mira el jugador en base a su velocidad
            let angleDeg = 0;
            if (this.player.velocity && this.player.velocity.lengthSq() > 0.1) {
                // atan2(x, -z) nos da el ángulo correcto porque en la pantalla CSS arriba es -Y y en 3D adelante es -Z
                angleDeg = Math.atan2(this.player.velocity.x, -this.player.velocity.z) * (180 / Math.PI);
            }
            
            pDot.style.left = `${pX}px`;
            pDot.style.top = `${pZ}px`;
            pDot.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
        }
        if (this._frame % 24 === 0) this.updateHudSafeLayout();
        if (this._frame % 4 === 0) this.updateNavigationHUD();

        tickFps();
        tickPerfBudget(getLastFps());
        const combatHeavy = this.enemyManager?.combatLoadLevel === 'heavy';
        if (this._useBloom && !combatHeavy) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
    }

    updateHudSafeLayout() {
        const playerPanel = document.getElementById('player-status');
        const missionPanel = document.getElementById('mission-panel');
        const targetPanel = document.getElementById('target-status');
        const systemMenu = document.getElementById('system-menu');
        const eventPanel = document.getElementById('world-event-panel');

        // Coloca misión justo debajo de vida para que nunca tape barras de HP/energía.
        if (playerPanel && missionPanel && missionPanel.style.display !== 'none') {
            const top = playerPanel.offsetTop + playerPanel.offsetHeight + 12;
            missionPanel.style.top = `${top}px`;
            missionPanel.style.left = `${playerPanel.offsetLeft}px`;
        }

        const creditsHud = document.getElementById('credits-hud');
        if (document.body.classList.contains('layout-mobile') && playerPanel && creditsHud) {
            creditsHud.style.top = `${playerPanel.offsetTop + playerPanel.offsetHeight + 6}px`;
            creditsHud.style.left = `${playerPanel.offsetLeft}px`;
        }

        // Reubica panel objetivo y chip piloto para no chocar con menú central.
        const pilotChip = document.getElementById('pilot-profile-chip');
        const worldNav = document.getElementById('world-nav-hud');

        if (pilotChip && playerPanel && !document.body.classList.contains('layout-mobile')) {
            pilotChip.style.top = `${playerPanel.offsetTop}px`;
            pilotChip.style.left = `${playerPanel.offsetLeft + playerPanel.offsetWidth + 12}px`;
        }

        if (worldNav && !document.body.classList.contains('layout-mobile')) {
            const leftBound = pilotChip
                ? pilotChip.offsetLeft + pilotChip.offsetWidth + 16
                : (playerPanel ? playerPanel.offsetLeft + playerPanel.offsetWidth + 16 : 260);
            const menuLeft = systemMenu ? systemMenu.offsetLeft : window.innerWidth - 280;
            const centerMax = menuLeft - 16;
            if (centerMax > leftBound + 180) {
                worldNav.style.top = '18px';
                worldNav.style.left = `${(leftBound + centerMax) / 2}px`;
                worldNav.style.transform = 'translateX(-50%)';
                worldNav.style.maxWidth = `${centerMax - leftBound - 8}px`;
            }
        }

        if (targetPanel) {
            const menuW = systemMenu ? systemMenu.offsetWidth : 0;
            const menuH = systemMenu ? systemMenu.offsetHeight : 0;
            const eventVisible = !!eventPanel && eventPanel.style.display !== 'none';
            const eventH = eventVisible ? eventPanel.offsetHeight : 0;

            let top = 18;
            let right = 18;

            if (window.innerWidth >= 1500) {
                // En pantallas amplias: poner objetivo a la izquierda del menú para abrir visión.
                right = menuW + 30;
            } else {
                // En pantallas más estrechas: bajar objetivo debajo del menú.
                top = 18 + menuH + 10;
            }

            if (eventVisible) {
                const eventTop = 82;
                top = Math.max(top, eventTop + eventH + 12);
            }

            targetPanel.style.top = `${top}px`;
            targetPanel.style.right = `${right}px`;
        }
    }

    updateNavigationHUD() {
        const headingEl = document.getElementById('nav-heading');
        const targetEl = document.getElementById('nav-target');
        if (!headingEl || !targetEl || !this.camera || !this.player) return;

        const camDir = this._navCamDir;
        this.camera.getWorldDirection(camDir);
        camDir.y = 0;
        if (camDir.lengthSq() < 0.0001) camDir.set(0, 0, -1);
        camDir.normalize();

        let heading = Math.atan2(camDir.x, -camDir.z) * (180 / Math.PI);
        if (heading < 0) heading += 360;
        const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
        const cardinal = cardinals[Math.round(heading / 45) % 8];
        headingEl.textContent = `Rumbo ${cardinal} ${Math.round(heading).toString().padStart(3, '0')}°`;

        const spaceNav = this.galaxy?.getSpaceNavInfo?.();
        if (spaceNav && this.galaxy?.usesOrbitalMinimap?.()) {
            const km = spaceNav.dist >= 1000
                ? `${(spaceNav.dist / 1000).toFixed(1)} km`
                : `${Math.round(spaceNav.dist)} m`;
            const inOrbit = this.galaxy?.worldMode === 'universe';
            if (!inOrbit) {
                targetEl.textContent = `${spaceNav.name} · ${km} · Numpad8 = ir al espacio`;
                return;
            }
            const camDir3 = this._navCamDir;
            this.camera.getWorldDirection(camDir3);
            const flatBearing = (Math.atan2(camDir3.x, -camDir3.z) * (180 / Math.PI) + 360) % 360;
            const rel = ((spaceNav.bearing - flatBearing + 540) % 360) - 180;
            let arrow = '↑';
            if (rel > 18 && rel <= 72) arrow = '↗';
            else if (rel > 72 && rel <= 132) arrow = '→';
            else if (rel > 132) arrow = '↘';
            else if (rel < -18 && rel >= -72) arrow = '↖';
            else if (rel < -72 && rel >= -132) arrow = '←';
            else if (rel < -132) arrow = '↙';
            const ap = spaceNav.autopilot ? ' · autopiloto' : ' · Tab = autopiloto';
            targetEl.textContent = `${spaceNav.name} ${arrow} ${km}${ap} · WASD cancela`;
            return;
        }

        if (this.player.navTarget) {
            const dx = this.player.navTarget.x - this.player.position.x;
            const dz = this.player.navTarget.z - this.player.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
            const combat = this.player.target?.userData?.name;
            targetEl.textContent = combat
                ? `Rumbo ${distText} · Combate: ${combat}`
                : `Destino a ${distText} · WASD cancela`;
            return;
        }

        if (this.player.target?.userData?.name) {
            targetEl.textContent = `Combate: ${this.player.target.userData.name} · Esc limpia`;
            return;
        }

        const mission = this.missionManager?.missions?.[this.missionManager.activeMissionIndex];
        const targetZone = mission?.targetZone;
        if (!targetZone) {
            targetEl.textContent = 'Clic mapa · Clic enemigo · C recentrar cámara';
            return;
        }

        const dx = targetZone.x - this.player.position.x;
        const dz = targetZone.z - this.player.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const bearing = (Math.atan2(dx, -dz) * (180 / Math.PI) + 360) % 360;
        const rel = ((bearing - heading + 540) % 360) - 180;

        let arrow = '↑';
        if (rel > 18 && rel <= 72) arrow = '↗';
        else if (rel > 72 && rel <= 132) arrow = '→';
        else if (rel > 132) arrow = '↘';
        else if (rel < -18 && rel >= -72) arrow = '↖';
        else if (rel < -72 && rel >= -132) arrow = '←';
        else if (rel < -132) arrow = '↙';

        const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
        targetEl.textContent = `Objetivo ${arrow} ${distText} · ${mission.title}`;
    }
}

_gameInstance = new Game();
window.__game = _gameInstance;
