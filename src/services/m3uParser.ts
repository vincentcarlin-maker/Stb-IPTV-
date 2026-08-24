import { Channel, VODItem, TVSeries } from '../types/iptv';

export interface ParsedM3UResult {
  channels: Channel[];
  vodMovies: VODItem[];
  seriesList: TVSeries[];
  movieCategories: string[];
  seriesCategories: string[];
}

export function parseM3UFull(m3uContent: string): ParsedM3UResult {
  const lines = m3uContent.split(/\r?\n/);
  const channels: Channel[] = [];
  const vodMovies: VODItem[] = [];
  const seriesMap = new Map<string, TVSeries>();
  const movieCategoryOrder: string[] = [];
  const seriesCategoryOrder: string[] = [];

  let currentInfo: any = null;
  let channelNumber = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentInfo = {};

      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const catchupMatch = line.match(/catchup="([^"]*)"/i);
      const catchupDaysMatch = line.match(/catchup-days="([^"]*)"/i);

      const commaIndex = line.lastIndexOf(',');
      let name = '';
      if (commaIndex !== -1) {
        name = line.substring(commaIndex + 1).trim();
      } else if (tvgNameMatch) {
        name = tvgNameMatch[1];
      } else {
        name = `Item ${channelNumber}`;
      }

      currentInfo.name = name;
      currentInfo.epgId = tvgIdMatch ? tvgIdMatch[1] : undefined;
      currentInfo.logo = tvgLogoMatch ? tvgLogoMatch[1] : undefined;
      currentInfo.category = groupMatch ? groupMatch[1].trim() : 'Généraliste';
      currentInfo.hasCatchup = Boolean(catchupMatch);
      currentInfo.catchupDays = catchupDaysMatch ? parseInt(catchupDaysMatch[1], 10) : 7;

      const upper = name.toUpperCase();
      if (upper.includes('4K') || upper.includes('UHD')) currentInfo.resolution = '4K';
      else if (upper.includes('FHD') || upper.includes('1080')) currentInfo.resolution = 'FHD';
      else if (upper.includes('HD') || upper.includes('720')) currentInfo.resolution = 'HD';
      else currentInfo.resolution = 'SD';

      if (
        upper.includes('ADULT') || 
        upper.includes('XXX') || 
        upper.includes('18+') || 
        upper.includes('PORN') ||
        (groupMatch && (groupMatch[1].toUpperCase().includes('ADULT') || groupMatch[1].toUpperCase().includes('XXX') || groupMatch[1].includes('+18')))
      ) {
        currentInfo.isLocked = true;
        currentInfo.category = 'Adulte / +18';
      }

    } else if (!line.startsWith('#') && currentInfo) {
      const streamUrl = line;
      const catUpper = (currentInfo.category || '').toUpperCase();
      const nameUpper = (currentInfo.name || '').toUpperCase();
      const urlUpper = streamUrl.toUpperCase();

      const isVideoFile = urlUpper.endsWith('.MP4') || urlUpper.endsWith('.MKV') || urlUpper.endsWith('.AVI') || urlUpper.endsWith('.MOV') || urlUpper.includes('/MOVIE/');
      const isVodCategory = catUpper.includes('VOD') || catUpper.includes('FILM') || catUpper.includes('MOVIE') || catUpper.includes('CINEMA');
      const isSeriesCategory = catUpper.includes('SERIE') || catUpper.includes('SERIES') || catUpper.includes('SAISON') || catUpper.includes('SEASON') || urlUpper.includes('/SERIES/');
      const hasEpisodePattern = /S\d+\s*E\d+/i.test(nameUpper) || /S\d+\.E\d+/i.test(nameUpper) || /E\d+/i.test(nameUpper);

      if (isSeriesCategory || (isVideoFile && hasEpisodePattern)) {
        // TV Series
        const seriesCat = currentInfo.category || 'Séries TV';
        if (!seriesCategoryOrder.includes(seriesCat)) {
          seriesCategoryOrder.push(seriesCat);
        }

        // Extract Season & Episode numbers
        let seasonNum = 1;
        let episodeNum = 1;

        const sMatch = nameUpper.match(/S(\d+)/i) || nameUpper.match(/SAISON\s*(\d+)/i) || nameUpper.match(/SEASON\s*(\d+)/i) || nameUpper.match(/(\d+)X\d+/i);
        if (sMatch) {
          const parsedS = parseInt(sMatch[1], 10);
          if (!isNaN(parsedS) && parsedS > 0) seasonNum = parsedS;
        }

        const eMatch = nameUpper.match(/E(\d+)/i) || nameUpper.match(/EP\s*(\d+)/i) || nameUpper.match(/ÉPISODE\s*(\d+)/i) || nameUpper.match(/EPISODE\s*(\d+)/i) || nameUpper.match(/\d+X(\d+)/i);
        if (eMatch) {
          const parsedE = parseInt(eMatch[1], 10);
          if (!isNaN(parsedE) && parsedE > 0) episodeNum = parsedE;
        }

        // Clean series title
        let seriesTitle = currentInfo.name
          .replace(/S\d+\s*E\d+.*$/i, '')
          .replace(/S\d+\.E\d+.*$/i, '')
          .replace(/S\d+.*$/i, '')
          .replace(/Saison\s*\d+.*$/i, '')
          .replace(/Season\s*\d+.*$/i, '')
          .replace(/\d+x\d+.*$/i, '')
          .replace(/[-|:]\s*$/, '')
          .trim();

        if (!seriesTitle) {
          seriesTitle = currentInfo.name;
        }

        const existing = seriesMap.get(seriesTitle);
        const episodeObj = {
          id: `ep-${Math.random().toString(36).substring(2, 7)}`,
          episodeNumber: episodeNum,
          seasonNumber: seasonNum,
          title: currentInfo.name,
          duration: '45m',
          streamUrl,
          thumbnail: currentInfo.logo,
        };

        if (existing) {
          let seasonObj = existing.seasons.find((s) => s.seasonNumber === seasonNum);
          if (!seasonObj) {
            seasonObj = {
              seasonNumber: seasonNum,
              title: `Saison ${seasonNum}`,
              name: `Saison ${seasonNum}`,
              episodes: [],
            };
            existing.seasons.push(seasonObj);
            existing.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
            existing.totalSeasons = existing.seasons.length;
          }
          if (!eMatch) {
            episodeObj.episodeNumber = seasonObj.episodes.length + 1;
          }
          seasonObj.episodes.push(episodeObj);
          seasonObj.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
        } else {
          seriesMap.set(seriesTitle, {
            id: `series-${Math.random().toString(36).substring(2, 7)}`,
            title: seriesTitle,
            poster: currentInfo.logo || 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80',
            backdrop: currentInfo.logo,
            category: seriesCat,
            rating: '12+',
            releaseYear: 2024,
            overview: `Série ${seriesTitle} issue de votre playlist M3U.`,
            genre: [seriesCat],
            totalSeasons: 1,
            seasons: [
              {
                seasonNumber: seasonNum,
                title: `Saison ${seasonNum}`,
                name: `Saison ${seasonNum}`,
                episodes: [episodeObj],
              },
            ],
          });
        }
      } else if (isVodCategory || isVideoFile) {
        // VOD Movie
        const movieCat = currentInfo.category || 'Films VOD';
        if (!movieCategoryOrder.includes(movieCat)) {
          movieCategoryOrder.push(movieCat);
        }
        vodMovies.push({
          id: `vod-${Math.random().toString(36).substring(2, 7)}`,
          title: currentInfo.name,
          streamUrl,
          poster: currentInfo.logo || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80',
          backdrop: currentInfo.logo,
          category: movieCat,
          rating: 'Tous publics',
          releaseYear: 2024,
          duration: '1h 40m',
          overview: `Film ${currentInfo.name} issu de votre playlist M3U.`,
          genre: [movieCat],
          isLocked: currentInfo.isLocked,
        });
      } else {
        // Live Channel
        channels.push({
          id: `ch-${channelNumber}-${Math.random().toString(36).substring(2, 7)}`,
          number: channelNumber++,
          name: currentInfo.name || `Canal ${channelNumber}`,
          streamUrl,
          logo: currentInfo.logo,
          category: currentInfo.category || 'Généraliste',
          epgId: currentInfo.epgId,
          resolution: currentInfo.resolution || 'HD',
          hasCatchup: currentInfo.hasCatchup,
          catchupDays: currentInfo.catchupDays,
          isLocked: currentInfo.isLocked,
          fps: 50,
        });
      }

      currentInfo = null;
    }
  }

  return {
    channels,
    vodMovies,
    seriesList: Array.from(seriesMap.values()),
    movieCategories: movieCategoryOrder,
    seriesCategories: seriesCategoryOrder,
  };
}

export function parseM3U(m3uContent: string): Channel[] {
  return parseM3UFull(m3uContent).channels;
}

