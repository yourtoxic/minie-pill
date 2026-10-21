import {httpGetJson} from '../util.js';

const enc = o => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

// Open-Meteo (no API key). Cached 20 min.
export class WeatherService {
    constructor(session) {
        this._session = session;
        this._cache = null;
    }

    // settings supplies weather-name / weather-lat / weather-lon / weather-units
    async get(settings, force = false) {
        let lat = settings.get_double('weather-lat');
        let lon = settings.get_double('weather-lon');
        const name = settings.get_string('weather-name');
        const units = settings.get_string('weather-units');

        if ((!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) && name) {
            // location name saved but no coordinates: resolve it now
            const g = await this._step('geocoding', () => httpGetJson(this._session,
                `https://geocoding-api.open-meteo.com/v1/search?${enc({name: name.split(',')[0], count: 1, language: 'en', format: 'json'})}`));
            const r = g.results?.[0];
            if (!r)
                throw new Error(`Location "${name}" not found`);
            lat = r.latitude;
            lon = r.longitude;
            settings.set_double('weather-lat', lat);
            settings.set_double('weather-lon', lon);
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0))
            throw new Error('No location set. Search a city in preferences.');

        const key = `${lat},${lon},${units}`;
        if (!force && this._cache && this._cache.key === key && Date.now() - this._cache.at < 20 * 60 * 1000)
            return this._cache.data;

        const imperial = units === 'imperial';
        const url = `https://api.open-meteo.com/v1/forecast?${enc({
            latitude: lat, longitude: lon,
            current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min',
            timezone: 'auto', forecast_days: 5,
            temperature_unit: imperial ? 'fahrenheit' : 'celsius',
            wind_speed_unit: imperial ? 'mph' : 'kmh',
        })}`;
        const data = await this._step('forecast', () => httpGetJson(this._session, url));
        if (data.error || !data.current || !data.daily)
            throw new Error(`forecast: ${data.reason ?? 'unexpected response'}`);
        this._cache = {key, at: Date.now(), data};
        return data;
    }

    async _step(label, fn) {
        try {
            return await fn();
        } catch (e) {
            throw new Error(`${label}: ${e.message}`);
        }
    }

    destroy() {
        this._cache = null;
    }
}
