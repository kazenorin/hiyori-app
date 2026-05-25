import { fileLog, log as logger } from '$lib/logging/logger';

export async function log(logMessage: string) {
	return Promise.all([logger.debug('tool', logMessage), fileLog('debug', 'tool', logMessage)]);
}
