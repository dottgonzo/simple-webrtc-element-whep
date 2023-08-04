const linkToIceServers = (links) => ((links !== null) ? links.split(', ').map((link) => {
    const m = link.match(/^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i);
    if (m === null) {
        throw new Error('invalid Link header');
    }
    const ret = {
        urls: [m[1]],
    };
    if (m[3] !== undefined) {
        ret.username = JSON.parse(`"${m[3]}"`);
        ret.credential = JSON.parse(`"${m[4]}"`);
        ret.credentialType = "password";
    }
    return ret;
}) : []);
const parseOffer = (offer) => {
    const ret = {
        iceUfrag: '',
        icePwd: '',
        medias: [],
    };
    for (const line of offer.split('\r\n')) {
        if (line.startsWith('m=')) {
            ret.medias.push(line.slice('m='.length));
        }
        else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) {
            ret.iceUfrag = line.slice('a=ice-ufrag:'.length);
        }
        else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:')) {
            ret.icePwd = line.slice('a=ice-pwd:'.length);
        }
    }
    return ret;
};
const generateSdpFragment = (offerData, candidates) => {
    const candidatesByMedia = {};
    for (const candidate of candidates) {
        const mid = candidate.sdpMLineIndex;
        if (candidatesByMedia[mid] === undefined) {
            candidatesByMedia[mid] = [];
        }
        candidatesByMedia[mid].push(candidate);
    }
    let frag = 'a=ice-ufrag:' + offerData.iceUfrag + '\r\n'
        + 'a=ice-pwd:' + offerData.icePwd + '\r\n';
    let mid = 0;
    for (const media of offerData.medias) {
        if (candidatesByMedia[mid] !== undefined) {
            frag += 'm=' + media + '\r\n'
                + 'a=mid:' + mid + '\r\n';
            for (const candidate of candidatesByMedia[mid]) {
                frag += 'a=' + candidate.candidate + '\r\n';
            }
        }
        mid++;
    }
    return frag;
};
export default class WHEPClient {
    constructor(options) {
        this.restartPause = 2000;
        this.pc = null;
        this.restartTimeout = null;
        this.eTag = '';
        this.queuedCandidates = [];
        this.offerData = null;
        if (!options?.videoElement)
            throw new Error('videoElement is required');
        if (!options.whepUri)
            throw new Error('whepUri is required');
        this.videoElement = options.videoElement;
        this.whepUri = options.whepUri;
        this.onOnline = options.onOnline;
        this.onOffline = options.onOffline;
        this.start();
    }
    start() {
        console.log("requesting ICE servers");
        fetch(this.whepUri, {
            method: 'OPTIONS',
        })
            .then((res) => this.onIceServers(res))
            .catch((err) => {
            console.log('error: ' + err);
            this.scheduleRestart();
        });
    }
    onIceServers(res) {
        this.pc = new RTCPeerConnection({
            iceServers: linkToIceServers(res.headers.get('Link')),
        });
        const direction = "sendrecv";
        this.pc.addTransceiver("video", { direction });
        this.pc.addTransceiver("audio", { direction });
        this.pc.onicecandidate = (evt) => this.onLocalCandidate(evt);
        this.pc.oniceconnectionstatechange = () => this.onConnectionState();
        this.pc.ontrack = (evt) => {
            console.log("new track:", evt.track.kind);
            this.videoElement.srcObject = evt.streams[0];
        };
        this.pc.createOffer()
            .then((offer) => this.onLocalOffer(offer));
    }
    onLocalOffer(offer) {
        if (!this.pc)
            throw new Error('pc is null');
        if (!offer.sdp)
            throw new Error('offer.sdp is null');
        this.offerData = parseOffer(offer.sdp);
        this.pc.setLocalDescription(offer);
        console.log("sending offer");
        fetch(this.whepUri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/sdp',
            },
            body: offer.sdp,
        })
            .then((res) => {
            if (res.status !== 201) {
                throw new Error('bad status code');
            }
            this.eTag = res.headers.get('E-Tag') || '';
            return res.text();
        })
            .then((sdp) => this.onRemoteAnswer(new RTCSessionDescription({
            type: 'answer',
            sdp,
        })))
            .catch((err) => {
            console.log('error: ' + err);
            this.scheduleRestart();
        });
    }
    onConnectionState() {
        if (this.restartTimeout !== null) {
            return;
        }
        if (!this.pc)
            throw new Error('pc is null');
        console.log("peer connection state:", this.pc.iceConnectionState);
        switch (this.pc.iceConnectionState) {
            case "disconnected":
                this.scheduleRestart();
        }
    }
    onRemoteAnswer(answer) {
        if (this.restartTimeout !== null) {
            return;
        }
        if (!this.pc)
            throw new Error('pc is null');
        this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        if (this.queuedCandidates.length !== 0) {
            this.sendLocalCandidates(this.queuedCandidates);
            this.queuedCandidates = [];
        }
    }
    onLocalCandidate(evt) {
        if (this.restartTimeout !== null) {
            return;
        }
        if (evt.candidate !== null) {
            if (this.eTag === '') {
                this.queuedCandidates.push(evt.candidate);
            }
            else {
                this.sendLocalCandidates([evt.candidate]);
            }
        }
    }
    sendLocalCandidates(candidates) {
        if (!this.offerData)
            throw new Error('offerData is null');
        fetch(this.whepUri, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/trickle-ice-sdpfrag',
                'If-Match': this.eTag || '',
            },
            body: generateSdpFragment(this.offerData, candidates),
        })
            .then((res) => {
            if (res.status !== 204) {
                throw new Error('bad status code');
            }
        })
            .catch((err) => {
            console.log('error: ' + err);
            this.scheduleRestart();
        });
    }
    scheduleRestart() {
        if (this.restartTimeout !== null) {
            return;
        }
        if (this.pc !== null) {
            this.pc.close();
            this.pc = null;
        }
        this.restartTimeout = setTimeout(() => {
            this.restartTimeout = null;
            this.start();
        }, this.restartPause);
        this.eTag = '';
        this.queuedCandidates = [];
    }
}
//# sourceMappingURL=index.js.map