/** URL pública compatible con Vite base './' y túneles. */
export function resolveModelUrl(path) {
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    const clean = path.replace(/^\//, '');
    const base = import.meta.env.BASE_URL || '/';
    return base.endsWith('/') ? `${base}${clean}` : `${base}/${clean}`;
}
