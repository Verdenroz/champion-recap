import { json } from '@sveltejs/kit';
import { getPlayerData } from '$lib/riot-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const gameName = url.searchParams.get('gameName');
		const tagLine = url.searchParams.get('tagLine');
		const platform = url.searchParams.get('platform') || 'na1';
		const region = url.searchParams.get('region') || 'americas';

		if (!gameName || !tagLine) {
			return json({ error: 'gameName and tagLine are required' }, { status: 400 });
		}

		const data = await getPlayerData(gameName, tagLine, platform, region);

		return json(data);
	} catch (error) {
		console.error('Error fetching player data:', error);

		if (error instanceof Error) {
			return json({ error: error.message }, { status: 500 });
		}

		return json({ error: 'Failed to fetch player data' }, { status: 500 });
	}
};
