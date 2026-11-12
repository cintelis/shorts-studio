#!/usr/bin/env python3
"""Upload a Short to the YouTube channel with title, description, tags and settings in one step.

    python tools/yt-upload.py <video.mp4> <youtube.json> [--privacy private|unlisted|public] [--publish-at ISO8601] [--dry-run]
    python tools/yt-upload.py --check        # only checks the credentials work; uploads nothing
    python tools/yt-upload.py --thumbnail-only <videoId> <image.jpg>   # set a custom thumbnail (JPEG/PNG under 2 MB)
    (or add --thumbnail image.jpg to an upload)

youtube.json:
    {
      "title": "...",                      # max 100 characters
      "description": "...",                # max 5000 characters
      "tags": ["...", "..."],              # max ~500 characters in total
      "categoryId": "28",                  # 28 = Science & Technology (default)
      "privacy": "private",                # default private; overridden by --privacy
      "publishAt": null,                   # optional ISO time; needs privacy "private"
      "aiUsed": false,                     # "Altered or synthetic content" answer (false = No)
      "madeForKids": false
    }

Credentials (never printed): client_secret.json + token.json (refresh_token) in the folder
YT_CRED_DIR, default ~/.config/youtube. The token's scope is youtube.upload, which allows
uploads but not editing existing videos, so all details are set at upload time.
"""
import json, os, sys, time, argparse, urllib.request, urllib.parse, urllib.error

CRED_DIR = os.environ.get('YT_CRED_DIR', os.path.join(os.path.expanduser('~'), '.config', 'youtube'))
CHUNK = 8 * 1024 * 1024


def access_token():
    cs = json.load(open(os.path.join(CRED_DIR, 'client_secret.json')))
    cs = cs.get('installed') or cs.get('web')
    tok = json.load(open(os.path.join(CRED_DIR, 'token.json')))
    body = urllib.parse.urlencode({
        'client_id': cs['client_id'], 'client_secret': cs['client_secret'],
        'refresh_token': tok['refresh_token'], 'grant_type': 'refresh_token',
    }).encode()
    req = urllib.request.Request(cs.get('token_uri', 'https://oauth2.googleapis.com/token'), data=body, method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'Token refresh failed: HTTP {e.code} {e.read().decode()[:300]}')
    return data['access_token'], data.get('scope', '')


def check_meta(m):
    errs = []
    if not m.get('title') or len(m['title']) > 100: errs.append('title missing or over 100 characters')
    if any(c in m.get('title', '') + m.get('description', '') for c in '<>'): errs.append('< or > not allowed in title/description')
    if len(m.get('description', '')) > 5000: errs.append('description over 5000 characters')
    tags = m.get('tags', [])
    tag_len = sum(len(t) + (2 if ' ' in t else 0) for t in tags) + max(0, len(tags) - 1)
    if tag_len > 500: errs.append(f'tags total {tag_len} > 500 characters')
    if errs: sys.exit('Metadata problems: ' + '; '.join(errs))


def upload(video, meta, privacy, publish_at):
    token, _ = access_token()
    status = {
        'privacyStatus': privacy,
        'selfDeclaredMadeForKids': bool(meta.get('madeForKids', False)),
        'containsSyntheticMedia': bool(meta.get('aiUsed', False)),
        'embeddable': True,
    }
    if publish_at:
        status['privacyStatus'] = 'private'
        status['publishAt'] = publish_at
    body = {
        'snippet': {
            'title': meta['title'], 'description': meta.get('description', ''),
            'tags': meta.get('tags', []), 'categoryId': str(meta.get('categoryId', '28')),
            'defaultLanguage': meta.get('language', 'en'), 'defaultAudioLanguage': meta.get('language', 'en'),
        },
        'status': status,
    }
    size = os.path.getsize(video)
    init = urllib.request.Request(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        data=json.dumps(body).encode(), method='POST',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json; charset=UTF-8',
                 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': str(size)})
    try:
        with urllib.request.urlopen(init) as r:
            url = r.headers['Location']
    except urllib.error.HTTPError as e:
        sys.exit(f'Upload start failed: HTTP {e.code} {e.read().decode()[:500]}')

    sent = 0
    with open(video, 'rb') as f:
        while sent < size:
            f.seek(sent)
            chunk = f.read(CHUNK)
            end = sent + len(chunk) - 1
            req = urllib.request.Request(url, data=chunk, method='PUT', headers={
                'Authorization': f'Bearer {token}', 'Content-Length': str(len(chunk)),
                'Content-Range': f'bytes {sent}-{end}/{size}'})
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(req) as r:
                        result = json.load(r)
                        print(f'\rUploaded {size / 1e6:.1f} MB', flush=True)
                        return result
                except urllib.error.HTTPError as e:
                    if e.code == 308:  # chunk accepted, more to send
                        rng = e.headers.get('Range')
                        sent = int(rng.split('-')[1]) + 1 if rng else sent
                        print(f'\r{sent / size * 100:5.1f}%', end='', flush=True)
                        break
                    if e.code in (500, 502, 503, 504) and attempt < 4:
                        time.sleep(2 ** attempt); continue
                    sys.exit(f'Upload failed: HTTP {e.code} {e.read().decode()[:500]}')
                except (urllib.error.URLError, TimeoutError):
                    if attempt < 4: time.sleep(2 ** attempt); continue
                    raise
    sys.exit('Upload ended without a response')


def set_thumbnail(video_id, image):
    token, _ = access_token()
    data = open(image, 'rb').read()
    if len(data) > 2 * 1024 * 1024: sys.exit('Thumbnail must be under 2 MB (save it as JPEG)')
    ctype = 'image/png' if image.lower().endswith('.png') else 'image/jpeg'
    req = urllib.request.Request(f'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={video_id}',
                                 data=data, method='POST', headers={'Authorization': f'Bearer {token}', 'Content-Type': ctype})
    try:
        with urllib.request.urlopen(req) as r: json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'Thumbnail failed: HTTP {e.code} {e.read().decode()[:300]}')
    print(f'Thumbnail set on {video_id}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video', nargs='?'); ap.add_argument('meta', nargs='?')
    ap.add_argument('--privacy', choices=['private', 'unlisted', 'public'])
    ap.add_argument('--publish-at'); ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--thumbnail'); ap.add_argument('--thumbnail-only', nargs=2, metavar=('VIDEO_ID', 'IMAGE'))
    a = ap.parse_args()
    if a.thumbnail_only:
        set_thumbnail(*a.thumbnail_only); return
    if a.check:
        _, scope = access_token()
        print('Credentials OK. Scope:', scope); return
    if not a.video or not a.meta: ap.error('video and meta are required')
    meta = json.load(open(a.meta, encoding='utf-8'))
    check_meta(meta)
    privacy = a.privacy or meta.get('privacy', 'private')
    publish_at = a.publish_at or meta.get('publishAt')
    print(f'Video: {a.video} ({os.path.getsize(a.video) / 1e6:.1f} MB)')
    print(f'Title: {meta["title"]}\nTags: {len(meta.get("tags", []))}  Category: {meta.get("categoryId", "28")}  '
          f'Privacy: {privacy}{"  publishAt " + publish_at if publish_at else ""}  AI used: {bool(meta.get("aiUsed", False))}')
    if a.dry_run:
        print('Dry run: nothing uploaded.'); return
    res = upload(a.video, meta, privacy, publish_at)
    vid = res['id']
    print(f'Done: https://youtube.com/shorts/{vid}\nStudio: https://studio.youtube.com/video/{vid}/edit')
    if a.thumbnail: set_thumbnail(vid, a.thumbnail)


if __name__ == '__main__':
    main()
