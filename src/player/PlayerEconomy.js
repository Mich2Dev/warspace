import * as THREE from 'three';
import { getItemById } from '../itemCatalog.js';
import { applyEquipmentToPlayer, PARTS } from '../balance.js';
import { getRecipeById, buildEquipmentFromRecipe } from '../craft.js';
import { scheduleWalletSave } from '../profile.js';

export const playerEconomyMethods = {
bootstrapInventory() {
        // Add currently equipped starter gear to inventory ownership list
        const starterItems = Object.values(this.equipment).map(item => this._cloneItem(item));
        starterItems.forEach(item => this.inventory.push(item));
    },

_cloneItem(item) {
        return {
            id: item.id,
            name: item.name,
            type: item.type,
            slot: item.type,
            level: item.level,
            rarity: item.rarity || 'common',
            manufacturer: item.manufacturer,
            description: item.description,
            stats: { ...item.stats },
            shopPrice: item.shopPrice || 0,
        };
    },

hasItem(itemId) {
        return this.inventory.some(i => i.id === itemId);
    },

isItemEquipped(itemId) {
        return Object.values(this.equipment).some(i => i && i.id === itemId);
    },

buyItem(itemId) {
        const shopItem = getItemById(itemId);
        if (!shopItem) return false;
        if (this.hasItem(itemId)) return false;
        if (!this.spendCredits(shopItem.price)) return false;

        const item = {
            id: shopItem.id,
            name: shopItem.name,
            type: shopItem.slot,
            slot: shopItem.slot,
            level: shopItem.level || 1,
            rarity: shopItem.rarity || 'common',
            manufacturer: shopItem.manufacturer || 'Desconocido',
            description: shopItem.description || '',
            stats: { ...shopItem.stats },
            shopPrice: shopItem.price || 0,
        };
        this.inventory.push(item);

        const logText = document.getElementById('log-text');
        if (logText) {
            logText.innerHTML = `<span style="color:#55cc88;font-weight:bold;">Compraste ${item.name}</span>`;
        }
        this._refreshTradeUI();
        return true;
    },

equipItem(itemId) {
        const item = this.inventory.find(i => i.id === itemId);
        if (!item) return false;
        const slot = item.slot || item.type;
        if (!slot || !this.equipment[slot]) return false;

        this.equipment[slot] = this._cloneItem(item);
        this.recalculateDerivedStats();
        this.updateEquipmentNamesInUI();
        this.updateUI();

        const logText = document.getElementById('log-text');
        if (logText) {
            logText.innerHTML = `<span style="color:#00e5ff;font-weight:bold;">Equipado: ${item.name}</span>`;
        }

        this._refreshTradeUI();
        return true;
    },

sellItem(itemId) {
        const idx = this.inventory.findIndex(i => i.id === itemId);
        if (idx < 0) return false;
        if (this.isItemEquipped(itemId)) return false;

        const item = this.inventory[idx];
        const basePrice = item.shopPrice || getItemById(itemId)?.price || 0;
        const sellValue = Math.max(1, Math.round(basePrice * 0.55));

        this.inventory.splice(idx, 1);
        this.credits += sellValue;
        this._updateCreditsUI();

        const logText = document.getElementById('log-text');
        if (logText) {
            logText.innerHTML = `<span style="color:#ffaa55;font-weight:bold;">Vendiste ${item.name} por ${sellValue} CR</span>`;
        }
        this._refreshTradeUI();
        return true;
    },

_refreshTradeUI() {
        if (typeof window.refreshArmoryPanel === 'function') window.refreshArmoryPanel();
    },

recalculateDerivedStats() {
        applyEquipmentToPlayer(this);
        this.hp = Math.min(this.hp, this.maxHp);
        this.energy = Math.min(this.energy, this.maxEnergy);
        Object.keys(this.upgrades).forEach(key => this._applyUpgrade(key));
    },

getPartLabel(partId) {
        const meta = PARTS[partId];
        return meta ? `${meta.icon} ${meta.name}` : partId;
    },

addPart(partId, qty = 1) {
        this.parts[partId] = (this.parts[partId] || 0) + qty;
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = `<span style="color:#88ffcc;font-weight:bold;">Pieza: ${this.getPartLabel(partId)} ×${qty}</span>`;
        }
        if (typeof window.refreshCraftPanel === 'function') window.refreshCraftPanel();
        this._refreshTradeUI();
        scheduleWalletSave(this);
    },

canCraft(recipe) {
        if (!recipe) return { canCraft: false, missing: '?' };
        if (this.credits < recipe.crCost) return { canCraft: false, missing: 'CR insuficiente' };
        for (const [partId, need] of Object.entries(recipe.parts)) {
            if ((this.parts[partId] || 0) < need) {
                return { canCraft: false, missing: this.getPartLabel(partId) };
            }
        }
        return { canCraft: true, missing: '' };
    },

craftComponent(recipeId) {
        const recipe = getRecipeById(recipeId);
        if (!recipe) return false;
        const check = this.canCraft(recipe);
        if (!check.canCraft) return false;

        this.credits -= recipe.crCost;
        for (const [partId, need] of Object.entries(recipe.parts)) {
            this.parts[partId] -= need;
            if (this.parts[partId] <= 0) delete this.parts[partId];
        }

        this.equipment[recipe.slot] = buildEquipmentFromRecipe(recipe);
        this.recalculateDerivedStats();
        this.updateEquipmentNamesInUI();
        this._updateCreditsUI();
        this.updateUI();

        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = `<span style="color:#55ccff;font-weight:bold;">Ensamblado: ${recipe.name} (MK-${recipe.level})</span>`;
        }
        this._pulseScreen('upgrade');
        scheduleWalletSave(this);
        this._refreshTradeUI();
        return true;
    },

updateEquipmentNamesInUI() {
        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.innerText = text;
        };
        set('slot-weapon-name', this.equipment.weapon.name);
        set('slot-missile-name', this.equipment.missile.name);
        set('slot-shield-name', this.equipment.shield.name);
        set('slot-engine-name', this.equipment.engine.name);
        set('slot-hull-name', this.equipment.hull.name);
        set('slot-repair-name', this.equipment.repair?.name || '—');
        set('slot-sight-name', this.equipment.sight?.name || '—');
    },

gainXP(amount) {
        this.xp += amount;
        this.accumulatedXpToLog = (this.accumulatedXpToLog || 0) + amount;
        let leveledUp = false;
        
        while (this.xp >= this.xpToNextLevel) {
            this.level++;
            this.xp -= this.xpToNextLevel;
            this.xpToNextLevel = Math.floor(this.xpToNextLevel * 1.5);
            
            this.maxHp += 100;
            this.hp = this.maxHp;
            this.energy = this.maxEnergy;
            
            leveledUp = true;
        }
        
        if (leveledUp) {
            this.triggerLevelUpEffect();
            window.__game?.worldHud?.pulseXp?.();
        }

        this.updateUI();

        if (this.xpLogTimeout) clearTimeout(this.xpLogTimeout);
        this.xpLogTimeout = setTimeout(() => {
            const logText = document.getElementById('log-text');
            if (logText) {
                if (leveledUp) {
                    logText.innerHTML = `<span style="color:#aa44ff; font-weight:bold;">SUBISTE DE NIVEL! Alcanzaste nivel ${this.level}. HP restaurado.</span>`;
                } else {
                    logText.innerText = `Gained ${this.accumulatedXpToLog} XP.`;
                }
            }
            this.accumulatedXpToLog = 0;
        }, 50);
    },

_showTerrainBlockedHint() {
        if (this._terrainHintCooldown > 0) return;
        this._terrainHintCooldown = 2.2;
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = '<span style="color:#ff9966;font-weight:bold;">Relieve muy escarpado — sube un poco o rodea el pico visible</span>';
        }
    },

    _showWorldBoundaryHint() {
        const g = window.__game?.galaxy;
        if (g?.isFlightMode?.() && (g._stratosphereViewActive || (g.getAltitudeAgl?.() ?? 0) >= 2500)) {
            return;
        }
        if (this._terrainHintCooldown > 0) return;
        this._terrainHintCooldown = 2.5;
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = '<span style="color:#66bbdd;font-weight:bold;">FRONTERA DEL SECTOR — no hay espacio más allá del anillo cyan</span>';
        }
    },

grantMissionReward(credits, xp) {
        this.credits += credits;
        if (xp > 0) this.gainXP(xp);
        else this.updateUI();
        this._updateCreditsUI();
        const el = document.getElementById('credit-popup');
        if (el) {
            clearTimeout(this._creditPopupTimeout);
            el.textContent = `MISIÓN +${credits} CR`;
            el.className = 'credit-popup big mission-reward';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
            this._creditPopupTimeout = setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(-10px)';
                el.className = 'credit-popup';
            }, 2800);
        }
    },

gainCredits(baseAmount, killPosition) {
        const now = this.time || 0;
        const prevStreak = this.killStreak;

        // Update kill streak
        if (now - this.lastKillTime < 4.5) {
            this.killStreak++;
        } else {
            this.killStreak = 1;
        }
        this.lastKillTime = now;

        // Streak multiplier caps at 3x
        this.streakMultiplier = Math.min(1 + (this.killStreak - 1) * 0.25, 3.0);

        // Final amount with streak + earnings upgrade
        const finalAmount = Math.round(baseAmount * this.streakMultiplier * (1 + this.creditMultiplierBonus));
        this.credits += finalAmount;

        // 3D floating credit text above kill position
        if (killPosition) this._spawnCreditFloat(finalAmount, killPosition);

        // Screen pulse when streak tier increases
        const prevTier = Math.floor((prevStreak - 1) / 2);
        const newTier  = Math.floor((this.killStreak - 1) / 2);
        if (this.killStreak >= 3 && newTier > prevTier) {
            this._pulseScreen('streak');
        }

        this._showCreditGain(finalAmount);
        this._updateStreakUI();
        this._updateCreditsUI();
        scheduleWalletSave(this);
    },

spendCredits(amount) {
        if (this.credits < amount) return false;
        this.credits -= amount;
        this._updateCreditsUI();
        scheduleWalletSave(this);
        return true;
    },

_updateCreditsUI() {
        const el = document.getElementById('credits-value');
        if (el) el.textContent = this.credits.toLocaleString();
        // Also refresh upgrade panel if open
        if (typeof window.refreshUpgradePanel === 'function') window.refreshUpgradePanel();
        this._refreshTradeUI();
    },

_updateStreakUI() {
        const el = document.getElementById('kill-streak');
        if (!el) return;
        if (this.killStreak >= 3) {
            const thresholds = [[15,'LEGENDARIO!!!'], [10,'DIVINO!!'], [7,'MASACRE!'], [5,'IMPARABLE!'], [3,'RACHA DE BAJAS']];
            const label = (thresholds.find(([n]) => this.killStreak >= n) || [0,''])[1];
            const sc = document.getElementById('streak-count');
            const sl = document.getElementById('streak-label');
            if (sc) sc.textContent = `x${this.killStreak}`;
            if (sl) sl.textContent = label;

            // Re-trigger CSS animation on every kill
            el.style.display = 'none';
            el.style.animation = 'none';
            void el.offsetWidth; // force reflow
            el.style.animation = '';
            el.style.display = 'flex';

            // Auto-hide after 4.5s of no kills
            clearTimeout(this._streakHideTimeout);
            this._streakHideTimeout = setTimeout(() => {
                this.killStreak = 0;
                this.streakMultiplier = 1;
                el.style.display = 'none';
            }, 4500);
        } else {
            el.style.display = 'none';
        }
    },

_spawnCreditFloat(amount, worldPos) {
        // Project 3D position to screen and show floating DOM text
        if (!this.camera) return;
        const vec = worldPos.clone().project(this.camera);
        const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-vec.y * 0.5 + 0.5) * window.innerHeight;
        // Only show if in front of camera (z < 1)
        if (vec.z >= 1) return;

        const el = document.createElement('div');
        el.className = 'credit-float';
        el.textContent = `+${amount}cr`;
        if (this.streakMultiplier > 1.5) el.classList.add('multiplied');
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
        document.body.appendChild(el);

        // Animate up and fade
        let startY = y, vy = -55, opacity = 1;
        const tick = () => {
            vy *= 0.96;
            startY += vy * 0.016;
            opacity -= 0.022;
            el.style.top = startY + 'px';
            el.style.opacity = opacity;
            if (opacity > 0) requestAnimationFrame(tick);
            else el.remove();
        };
        requestAnimationFrame(tick);
    },

_showCreditGain(amount) {
        const el = document.getElementById('credit-popup');
        if (!el) return;
        clearTimeout(this._creditPopupTimeout);

        const mult = this.streakMultiplier;
        el.textContent = mult > 1.01
            ? `+${amount}cr  ×${mult.toFixed(1)}`
            : `+${amount}cr`;
        el.className = 'credit-popup' + (mult >= 2.5 ? ' big' : mult >= 1.5 ? ' med' : '');
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';

        this._creditPopupTimeout = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-10px)';
        }, 1100);
    },

buyUpgrade(type) {
        const costs = this.UPGRADE_COSTS[type];
        if (!costs) return false;
        const tier = this.upgrades[type];
        if (tier >= costs.length) return false; // already max

        const cost = costs[tier];
        if (!this.spendCredits(cost)) {
            // Flash red — can't afford
            this._pulseScreen('error');
            return false;
        }

        this.upgrades[type]++;
        this._applyUpgrade(type);
        this.updateUI();

        // Screen flash + streak on upgrade
        this._pulseScreen('upgrade');
        return true;
    },

_applyUpgrade(type) {
        const t = this.upgrades[type];
        switch (type) {
            case 'damage':
                this.baseDamage = this.equipment.weapon.stats.damage * (1 + t * 0.30);
                break;
            case 'fireRate': {
                const fr = this.equipment.weapon.stats.fireRate || 4;
                this.shootCooldownMs = Math.round(1000 / fr * Math.pow(0.80, t));
                break;
            }
            case 'speed':
                this.speed = this.equipment.engine.stats.speed * (1 + t * 0.20);
                break;
            case 'maxHp': {
                const hpBonus = t * 75;
                this.maxHp = this.equipment.hull.stats.maxHp + hpBonus;
                this.hp = Math.min(this.hp + 75, this.maxHp); // partial heal
                break;
            }
            case 'energyRegen':
                this.energyRegenRate = 8 * (1 + t * 0.30);
                break;
            case 'missiles':
                this.missileCooldown = this.equipment.missile.stats.cooldown * Math.pow(0.75, t);
                break;
            case 'earnings':
                this.creditMultiplierBonus = t * 0.20;
                break;
        }
    },

    _disposeLevelUpFx() {
        const fx = this._levelUpFx;
        if (!fx) return;
        if (fx._cleanupTimer) {
            clearTimeout(fx._cleanupTimer);
            fx._cleanupTimer = null;
        }
        if (fx.ring1) this.scene.remove(fx.ring1);
        if (fx.particles) this.scene.remove(fx.particles);
        if (fx.levelText) this.scene.remove(fx.levelText);
        fx.ringMat?.dispose?.();
        fx.pGeo?.dispose?.();
        fx.pMat?.dispose?.();
        fx.spriteMat?.dispose?.();
        if (fx.light) fx.light.intensity = 0;
        this._levelUpFx = null;
    },

    triggerLevelUpEffect() {
        this._disposeLevelUpFx();

        const ringMat = this.lvlRingMat.clone();
        ringMat.opacity = 0.85;

        const ring1 = new THREE.Mesh(this.lvlRingGeo1, ringMat);
        ring1.rotation.x = Math.PI / 2;
        ring1.position.copy(this.mesh.position);
        this.scene.add(ring1);

        const light = this.levelUpLight;
        light.position.copy(this.mesh.position);
        light.position.y += 10;
        light.intensity = 6;

        const particleCount = 10;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(particleCount * 3);
        const pVel = [];
        for (let i = 0; i < particleCount; i++) {
            pPos[i * 3] = this.mesh.position.x + (Math.random() - 0.5) * 30;
            pPos[i * 3 + 1] = this.mesh.position.y + Math.random() * 8;
            pPos[i * 3 + 2] = this.mesh.position.z + (Math.random() - 0.5) * 30;
            pVel.push(Math.random() * 1.5 + 0.5);
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = this.lvlPMat.clone();
        pMat.opacity = 0.9;
        const particles = new THREE.Points(pGeo, pMat);
        this.scene.add(particles);

        this.lvlCtx.clearRect(0, 0, 512, 256);
        this.lvlCtx.font = 'bold 80px "Arial Black", Arial';
        this.lvlCtx.textAlign = 'center';
        this.lvlCtx.textBaseline = 'middle';
        this.lvlCtx.fillStyle = '#ffffff';
        this.lvlCtx.shadowColor = '#ffaa00';
        this.lvlCtx.shadowBlur = 20;
        this.lvlCtx.fillText(`NIVEL ${this.level}`, 256, 128);
        this.lvlTex.needsUpdate = true;

        const spriteMat = this.lvlSpriteMat.clone();
        spriteMat.opacity = 1.0;
        const levelText = new THREE.Sprite(spriteMat);
        levelText.scale.set(60, 30, 1);
        levelText.position.copy(this.mesh.position);
        levelText.position.y += 20;
        this.scene.add(levelText);

        this._levelUpFx = {
            ring1,
            ringMat,
            particles,
            pGeo,
            pMat,
            pVel,
            levelText,
            spriteMat,
            light,
            t: 0,
        };
        this._levelUpFx._cleanupTimer = setTimeout(() => this._disposeLevelUpFx(), 1300);
    },

    updateLevelUpFx(delta) {
        const fx = this._levelUpFx;
        if (!fx) return;
        fx.t += delta;

        fx.ring1.position.y += delta * 18;
        fx.ring1.rotation.z += delta * 2.2;
        const scale = 1 + fx.t * 0.35;
        fx.ring1.scale.set(scale, scale, 1);

        fx.levelText.position.y += delta * 5;

        const positions = fx.particles.geometry.attributes.position.array;
        for (let i = 0; i < fx.pVel.length; i++) {
            positions[i * 3 + 1] += fx.pVel[i] * delta * 12;
        }
        fx.particles.geometry.attributes.position.needsUpdate = true;

        const fade = Math.max(0, 1 - fx.t / 1.1);
        fx.ringMat.opacity = fade * 0.85;
        fx.pMat.opacity = fade * 0.9;
        fx.spriteMat.opacity = fade;
        fx.light.intensity = fade * 6;

        if (fx.t >= 1.15) {
            this._disposeLevelUpFx();
        }
    },

initInventoryUI() {
        /* Carga unificada en #armory-modal (armory.js) */
    },

toggleInventory() {
        if (typeof window.toggleArmory === 'function') window.toggleArmory();
    },

renderInventoryDetails(type) {
        const item = this.equipment[type];
        if (!item) return;

        document.getElementById('inv-item-name').innerText = item.name + ` [Niv ${item.level}]`;
        document.getElementById('inv-item-mfg').innerText = `Manufacturer: ${item.manufacturer}`;
        document.getElementById('inv-item-lore').innerText = `"${item.description}"`;

        const statsContainer = document.getElementById('inv-item-stats');
        statsContainer.innerHTML = ''; // clear

        for (const [key, value] of Object.entries(item.stats)) {
            // Format key
            const formattedKey = key.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
            
            const row = document.createElement('div');
            row.className = 'stat-row';
            
            const label = document.createElement('div');
            label.className = 'stat-label';
            label.innerText = formattedKey;
            
            const val = document.createElement('div');
            val.className = 'stat-value';
            val.innerText = value;

            row.appendChild(label);
            row.appendChild(val);
            statsContainer.appendChild(row);
        }
    },
};
