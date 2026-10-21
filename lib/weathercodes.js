// Open-Meteo WMO weather codes -> text + Adwaita symbolic icon.
export function describeWeather(code, isDay = true) {
    const night = !isDay;
    if (code === 0)
        return {text: 'Clear', icon: night ? 'weather-clear-night-symbolic' : 'weather-clear-symbolic'};
    if (code === 1 || code === 2)
        return {text: code === 1 ? 'Mostly clear' : 'Partly cloudy', icon: night ? 'weather-few-clouds-night-symbolic' : 'weather-few-clouds-symbolic'};
    if (code === 3)
        return {text: 'Overcast', icon: 'weather-overcast-symbolic'};
    if (code === 45 || code === 48)
        return {text: 'Fog', icon: 'weather-fog-symbolic'};
    if (code >= 51 && code <= 57)
        return {text: 'Drizzle', icon: 'weather-showers-scattered-symbolic'};
    if (code >= 61 && code <= 67)
        return {text: 'Rain', icon: 'weather-showers-symbolic'};
    if ((code >= 71 && code <= 77) || code === 85 || code === 86)
        return {text: 'Snow', icon: 'weather-snow-symbolic'};
    if (code >= 80 && code <= 82)
        return {text: 'Rain showers', icon: 'weather-showers-symbolic'};
    if (code >= 95)
        return {text: 'Thunderstorm', icon: 'weather-storm-symbolic'};
    return {text: 'Unknown', icon: 'weather-overcast-symbolic'};
}
