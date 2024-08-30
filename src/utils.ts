// utils.ts

// Utility to debounce rebuilds
export function debounceFactory<F extends (...args: unknown[]) => unknown>(func: F, wait: number) {
    let timeout: ReturnType<typeof setTimeout>;

    return (...args: Parameters<F>): void => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}
