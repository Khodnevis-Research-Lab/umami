(window => {
  const {
    screen: { width, height },
    navigator: { language },
    location,
    localStorage,
    document,
    history,
  } = window;
  const { hostname, href } = location;
  const { currentScript, referrer } = document;

  if (!currentScript) return;

  const _data = 'data-';
  const _false = 'false';
  const _true = 'true';
  const attr = currentScript.getAttribute.bind(currentScript);
  const website = attr(_data + 'website-id');
  const hostUrl = attr(_data + 'host-url');
  const tag = attr(_data + 'tag');
  const autoTrack = attr(_data + 'auto-track') !== _false;
  const excludeSearch = attr(_data + 'exclude-search') === _true;
  const domain = attr(_data + 'domains') || '';
  const domains = domain.split(',').map(n => n.trim());
  const host =
    hostUrl || '__COLLECT_API_HOST__' || currentScript.src.split('/').slice(0, -1).join('/');
  const endpoint = `${host.replace(/\/$/, '')}__COLLECT_API_ENDPOINT__`;
  const screen = `${width}x${height}`;
  const eventRegex = /data-umami-event-([\w-_]+)/;
  const eventNameAttribute = _data + 'umami-event';
  const delayDuration = 300;
  const userTrackIDCookie = 'growthIQ-trid';

  /* Helper functions */

  function uuid() {
    // Get the current time in milliseconds since the Unix epoch.
    var dt = new Date().getTime();
    // Replace the placeholders in the UUID template with random hexadecimal characters.
    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      // Generate a random hexadecimal digit.
      var r = (dt + Math.random() * 16) % 16 | 0;
      // Update dt to simulate passage of time for the next random character.
      dt = Math.floor(dt / 16);
      // Replace 'x' with a random digit and 'y' with a specific digit (4 for UUID version 4).
      return (c == 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    // Return the generated UUID.
    return uuid;
  }

  const encode = str => {
    if (!str) {
      return undefined;
    }

    try {
      const result = decodeURI(str);

      if (result !== str) {
        return result;
      }
    } catch {
      return str;
    }

    return encodeURI(str);
  };

  const parseURL = url => {
    try {
      const { pathname, search } = new URL(url);
      url = pathname + search;
    } catch {
      /* empty */
    }
    return excludeSearch ? url.split('?')[0] : url;
  };

  function setCookie(cookieName, value, expireDays) {
    const date = new Date();
    const exDays = expireDays || 1000;
    date.setTime(date.getTime() + exDays * 24 * 60 * 60 * 1000);
    const expires = `expires=${date.toUTCString()}`;
    const domain = window.location.hostname;
    const secure = 'secure';
    document.cookie = `${cookieName}=${value};${expires};path=/; domain=${domain}; ${secure}; sameSite=strict;`;
  }

  function getCookie(cookieName) {
    const name = cookieName + '=';
    const cookiesList = document.cookie.split(';');
    for (let i = 0; i < cookiesList.length; i++) {
      let cookie = cookiesList[i];
      while (cookie.charAt(0) == ' ') {
        cookie = cookie.substring(1);
      }
      if (cookie.indexOf(name) == 0) {
        return cookie.substring(name.length, cookie.length);
      }
    }
    return '';
  }

  const saveUserTrackId = userId => {
    if (typeof userId === 'string') setCookie(userTrackIDCookie, userId);
  };

  const getPayload = () => ({
    website,
    hostname,
    screen,
    language,
    title: encode(title),
    url: encode(currentUrl),
    referrer: encode(currentRef),
    tag: tag ? tag : undefined,
    userTrackID: getCookie(userTrackIDCookie),
  });

  // set a random cookie if not exist
  const initUserTrackIdCookie = () => {
    const trackIdCookie = getCookie(userTrackIDCookie);
    if (!trackIdCookie) {
      setCookie(userTrackIDCookie, uuid());
    }
  };

  /* Event handlers */

  const handlePush = (state, title, url) => {
    if (!url) return;

    currentRef = currentUrl;
    currentUrl = parseURL(url.toString());

    if (currentUrl !== currentRef) {
      setTimeout(track, delayDuration);
    }
  };

  const handlePathChanges = () => {
    const hook = (_this, method, callback) => {
      const orig = _this[method];

      return (...args) => {
        callback.apply(null, args);

        return orig.apply(_this, args);
      };
    };

    history.pushState = hook(history, 'pushState', handlePush);
    history.replaceState = hook(history, 'replaceState', handlePush);
  };

  const handleTitleChanges = () => {
    const observer = new MutationObserver(([entry]) => {
      title = entry && entry.target ? entry.target.text : undefined;
    });

    const node = document.querySelector('head > title');

    if (node) {
      observer.observe(node, {
        subtree: true,
        characterData: true,
        childList: true,
      });
    }
  };

  const handleClicks = () => {
    document.addEventListener(
      'click',
      async e => {
        const isSpecialTag = tagName => ['BUTTON', 'A'].includes(tagName);

        const trackElement = async el => {
          const attr = el.getAttribute.bind(el);
          const eventName = attr(eventNameAttribute);

          if (eventName) {
            const eventData = {};

            el.getAttributeNames().forEach(name => {
              const match = name.match(eventRegex);

              if (match) {
                eventData[match[1]] = attr(name);
              }
            });

            return track(eventName, eventData);
          }
        };

        const findParentTag = (rootElem, maxSearchDepth) => {
          let currentElement = rootElem;
          for (let i = 0; i < maxSearchDepth; i++) {
            if (isSpecialTag(currentElement.tagName)) {
              return currentElement;
            }
            currentElement = currentElement.parentElement;
            if (!currentElement) {
              return null;
            }
          }
        };

        const el = e.target;
        const parentElement = isSpecialTag(el.tagName) ? el : findParentTag(el, 10);

        if (parentElement) {
          const { href, target } = parentElement;
          const eventName = parentElement.getAttribute(eventNameAttribute);

          if (eventName) {
            if (parentElement.tagName === 'A') {
              const external =
                target === '_blank' ||
                e.ctrlKey ||
                e.shiftKey ||
                e.metaKey ||
                (e.button && e.button === 1);

              if (eventName && href) {
                if (!external) {
                  e.preventDefault();
                }
                return trackElement(parentElement).then(() => {
                  if (!external) location.href = href;
                });
              }
            } else if (parentElement.tagName === 'BUTTON') {
              return trackElement(parentElement);
            }
          }
        } else {
          return trackElement(el);
        }
      },
      true,
    );
  };

  /* Tracking functions */

  const trackingDisabled = () =>
    (localStorage && localStorage.getItem('umami.disabled')) ||
    (domain && !domains.includes(hostname));

  const send = async (payload, type = 'event') => {
    if (trackingDisabled()) return;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (typeof cache !== 'undefined') {
      headers['x-umami-cache'] = cache;
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ type, payload }),
        headers,
      });
      const text = await res.text();

      return (cache = text);
    } catch {
      /* empty */
    }
  };

  const track = (obj, data) => {
    if (typeof obj === 'string') {
      return send({
        ...getPayload(),
        name: obj,
        data: typeof data === 'object' ? data : undefined,
      });
    } else if (typeof obj === 'object') {
      return send(obj);
    } else if (typeof obj === 'function') {
      return send(obj(getPayload()));
    }
    return send(getPayload());
  };

  const identify = data => send({ ...getPayload(), data }, 'identify');

  /* Start */

  if (!window.umami) {
    window.umami = {
      track,
      identify,
    };
  }

  if (!window.saveUserID) {
    window.saveUserID = saveUserTrackId;
  }

  let currentUrl = parseURL(href);
  let currentRef = referrer !== hostname ? referrer : '';
  let title = document.title;
  let cache;
  let initialized;

  if (autoTrack && !trackingDisabled()) {
    handlePathChanges();
    handleTitleChanges();
    handleClicks();
    initUserTrackIdCookie();

    const init = () => {
      if (document.readyState === 'complete' && !initialized) {
        track();
        initialized = true;
      }
    };

    document.addEventListener('readystatechange', init, true);

    init();
  }
})(window);
