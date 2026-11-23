import { sileo } from 'sileo';

/**
 * Centralized Sileo toast notification helper for IntegrityFlow Dashboard.
 * Keeps toast defaults, durations, and roundness consistent with the
 * Layered Frosted Glassmorphism theme across light & dark modes.
 */
const DEFAULT_OPTIONS = {
    roundness: 12
};

export const notify = {
    success(title, description, options = {}) {
        return sileo.success({
            ...DEFAULT_OPTIONS,
            duration: 3800,
            title,
            ...(description ? { description } : {}),
            ...options
        });
    },

    error(title, description, options = {}) {
        return sileo.error({
            ...DEFAULT_OPTIONS,
            duration: 5500,
            title,
            ...(description ? { description } : {}),
            ...options
        });
    },

    warning(title, description, options = {}) {
        return sileo.warning({
            ...DEFAULT_OPTIONS,
            duration: 4800,
            title,
            ...(description ? { description } : {}),
            ...options
        });
    },

    info(title, description, options = {}) {
        return sileo.info({
            ...DEFAULT_OPTIONS,
            duration: 4000,
            title,
            ...(description ? { description } : {}),
            ...options
        });
    },

    action(title, description, button, options = {}) {
        return sileo.action({
            ...DEFAULT_OPTIONS,
            duration: 6000,
            title,
            ...(description ? { description } : {}),
            button,
            ...options
        });
    },

    promise(promiseOrFn, { loading, success, error, ...rest }) {
        return sileo.promise(promiseOrFn, {
            loading: typeof loading === 'string' ? { ...DEFAULT_OPTIONS, title: loading } : { ...DEFAULT_OPTIONS, ...loading },
            success: typeof success === 'string' ? { ...DEFAULT_OPTIONS, title: success } : success,
            error: typeof error === 'string' ? { ...DEFAULT_OPTIONS, title: error } : error,
            ...rest
        });
    },

    dismiss(id) {
        return sileo.dismiss(id);
    },

    clear(position) {
        return sileo.clear(position);
    }
};

export default notify;
