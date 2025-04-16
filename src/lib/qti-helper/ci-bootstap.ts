export const CES = `

const postToParentWindows = (type, data) => {
    window.top.postMessage(data ? { type, data } : { type }, '*');
    let w = window.parent;
    while (w) {
      if (w !== window.top) {
          w.postMessage({ type, data }, '*');
      }
      if (w !== w.parent) {
        w = w.parent;
      } else {
        w = null;
      }
    }
};

window.CES = {
  media: null,
  response: null,
  load: () => {
    let resolveCount = 0;

    const handleMessage = (event) => {
      if (event.data.type === "mediaData") {
        const media = event.data.data;
        CES.media = media;
        resolveCount++;
      } else if (event.data.type === "responseData") {
        const response = event.data.data;

        CES.response = response;
        resolveCount++;
      }
      if (resolveCount === 2) {
        window.removeEventListener("message", handleMessage);
      }
    };
    window.addEventListener("message", handleMessage);
    postToParentWindows("getMedia");
    postToParentWindows("getResponse");
  },
  setResponse: (data) => {
    postToParentWindows("setResponse", data);
  },
  getResponse: () => {
    return CES.response;
  },
  getMedia: () => {
    return CES.media;
  },
  setStageHeight: () => {
    postToParentWindows("setResponse");
  },
};
`;

export const ciBootstrap = `
  window.onload = async function () {
    const handleMessage = event => {
      if (event.data.type === 'mediaData') {
        const media = event.data.data;
        var n = document.createElement('iframe');
        n.frameBorder = '0';
        n.scrolling = 'no';
        n.src = media[0];
        document.body.appendChild(n);
        window.removeEventListener('message', handleMessage);
      }
    };
    window.addEventListener('message', handleMessage);
    let w = window.parent;
    while (w) {
      w.postMessage({ type: 'getMedia' }, '*');
      if (w !== w.parent) {
        w = w.parent;
      } else {
        w = null;
      }
    }
};
`;

export const registerCES = `${CES}
    CES.load();
;`;
