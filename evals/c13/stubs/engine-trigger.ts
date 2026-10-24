export const triggerStep = async (i: any) => ({ success: true, data: { triggered: true, ...(i.triggerData || {}) } });
