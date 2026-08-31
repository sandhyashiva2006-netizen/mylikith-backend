/*
=========================================================
AUDIO NOVEL COVER URL HELPERS
=========================================================

Audio novel cover objects live in the private B2 bucket.
The browser must never receive/store a short-lived B2 GET
signature as the cover_url.

These helpers convert legacy/direct B2 cover URLs to the
stable MyLikith backend cover endpoint.
*/

function getAudioCoverProxyUrl(novelId) {
    const id = Number(novelId);

    if (!Number.isInteger(id) || id <= 0) {
        return "";
    }

    const base = String(
        process.env.PUBLIC_API_BASE_URL ||
        "https://mylikith-backend.onrender.com"
    )
        .trim()
        .replace(/\/+$/, "");

    return `${base}/api/audio/media/novels/${id}/cover`;
}

function isAudioCoverProxyUrl(url, novelId) {
    const proxy = getAudioCoverProxyUrl(novelId);

    if (!proxy || !url) {
        return false;
    }

    try {
        const a = new URL(String(url));
        const b = new URL(proxy);

        return (
            a.origin === b.origin &&
            a.pathname === b.pathname
        );
    } catch (_) {
        return false;
    }
}

function isB2AudioCoverUrl(url, novelId) {
    if (!url || !novelId) {
        return false;
    }

    try {
        const parsed = new URL(String(url));
        const endpoint = String(
            process.env.B2_ENDPOINT || ""
        )
            .trim()
            .replace(/\/+$/, "");

        if (!endpoint) {
            return false;
        }

        const endpointHost =
            new URL(endpoint).hostname;

        if (parsed.hostname !== endpointHost) {
            return false;
        }

        const bucket =
            String(process.env.B2_BUCKET_NAME || "").trim();

        if (!bucket) {
            return false;
        }

        const path =
            parsed.pathname
                .replace(/^\/+/, "")
                .toLowerCase();

        const expected =
            `${bucket}/audio/${Number(novelId)}/cover/`
                .toLowerCase();

        return path.startsWith(expected);
    } catch (_) {
        return false;
    }
}

function normalizeAudioCoverUrl(novelId, coverUrl) {
    const value =
        String(coverUrl || "").trim();

    if (!value) {
        return "";
    }

    if (
        isAudioCoverProxyUrl(
            value,
            novelId
        ) ||
        isB2AudioCoverUrl(
            value,
            novelId
        )
    ) {
        return getAudioCoverProxyUrl(novelId);
    }

    return value;
}

module.exports = {
    getAudioCoverProxyUrl,
    isAudioCoverProxyUrl,
    isB2AudioCoverUrl,
    normalizeAudioCoverUrl
};
