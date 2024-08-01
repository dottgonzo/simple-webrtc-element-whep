export default class WHEPClient {
  retryPause = 2000

  video: HTMLVideoElement

  nonAdvertisedCodecs: string[] = []
  pc: RTCPeerConnection | null = null

  restartTimeout: number | null = null

  sessionUrl = ''
  offerData:
    | {
        iceUfrag: string
        icePwd: string
        medias: string[]
      }
    | undefined
  queuedCandidates: RTCIceCandidate[] = []
  defaultControls = false
  onOnline: () => void
  onOffline: () => void
  online = false
  whepUri: string
  constructor(
    video: HTMLVideoElement,
    options: {
      whepUri: string
      controls?: boolean
      muted?: boolean
      autoplay?: boolean
      playsInline?: boolean
      onOnline?: () => void
      onOffline?: () => void
    }
  ) {
    this.video = video

    this.whepUri = options.whepUri
    if (options.controls !== false) this.video.controls = true
    if (options.muted !== false) this.video.muted = true
    if (options.autoplay !== true) this.video.autoplay = true
    if (options.playsInline !== true) this.video.playsInline = true

    this.defaultControls = this.video.controls

    this.onOnline =
      options.onOnline ||
      (() => {
        console.log('online')
      })
    this.onOffline =
      options.onOffline ||
      (() => {
        console.log('offline')
      })

    this.init()
  }

  unquoteCredential = (v: string) => JSON.parse(`"${v}"`)

  linkToIceServers = (links: string) =>
    links !== null
      ? links.split(', ').map(link => {
          const m = link.match(
            /^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i
          )
          if (m === null) {
            return null
          }
          const ret: {
            urls: string[]
            username?: string
            credential?: string
            credentialType?: string
          } = {
            urls: [m[1]]
          }

          if (m[3] !== undefined) {
            ret.username = this.unquoteCredential(m[3])
            ret.credential = this.unquoteCredential(m[4])
            ret.credentialType = 'password'
          }

          return ret
        })
      : []

  parseOffer = (sdp: string) => {
    const ret: {
      iceUfrag: string
      icePwd: string
      medias: string[]
    } = {
      iceUfrag: '',
      icePwd: '',
      medias: []
    }

    for (const line of sdp.split('\r\n')) {
      if (line.startsWith('m=')) {
        ret.medias.push(line.slice('m='.length))
      } else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) {
        ret.iceUfrag = line.slice('a=ice-ufrag:'.length)
      } else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:')) {
        ret.icePwd = line.slice('a=ice-pwd:'.length)
      }
    }

    return ret
  }

  enableStereoPcmau = (section: string) => {
    let lines = section.split('\r\n')

    lines[0] += ' 118'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:118 PCMU/8000/2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:118 transport-cc')

    lines[0] += ' 119'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:119 PCMA/8000/2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:119 transport-cc')

    return lines.join('\r\n')
  }

  enableMultichannelOpus = (section: string) => {
    let lines = section.split('\r\n')

    lines[0] += ' 112'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:112 multiopus/48000/3')
    lines.splice(lines.length - 1, 0, 'a=fmtp:112 channel_mapping=0,2,1;num_streams=2;coupled_streams=1')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:112 transport-cc')

    lines[0] += ' 113'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:113 multiopus/48000/4')
    lines.splice(lines.length - 1, 0, 'a=fmtp:113 channel_mapping=0,1,2,3;num_streams=2;coupled_streams=2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:113 transport-cc')

    lines[0] += ' 114'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:114 multiopus/48000/5')
    lines.splice(lines.length - 1, 0, 'a=fmtp:114 channel_mapping=0,4,1,2,3;num_streams=3;coupled_streams=2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:114 transport-cc')

    lines[0] += ' 115'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:115 multiopus/48000/6')
    lines.splice(lines.length - 1, 0, 'a=fmtp:115 channel_mapping=0,4,1,2,3,5;num_streams=4;coupled_streams=2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:115 transport-cc')

    lines[0] += ' 116'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:116 multiopus/48000/7')
    lines.splice(lines.length - 1, 0, 'a=fmtp:116 channel_mapping=0,4,1,2,3,5,6;num_streams=4;coupled_streams=4')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:116 transport-cc')

    lines[0] += ' 117'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:117 multiopus/48000/8')
    lines.splice(lines.length - 1, 0, 'a=fmtp:117 channel_mapping=0,6,1,4,5,2,3,7;num_streams=5;coupled_streams=4')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:117 transport-cc')

    return lines.join('\r\n')
  }

  enableL16 = (section: string) => {
    let lines = section.split('\r\n')

    lines[0] += ' 120'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:120 L16/8000/2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:120 transport-cc')

    lines[0] += ' 121'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:121 L16/16000/2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:121 transport-cc')

    lines[0] += ' 122'
    lines.splice(lines.length - 1, 0, 'a=rtpmap:122 L16/48000/2')
    lines.splice(lines.length - 1, 0, 'a=rtcp-fb:122 transport-cc')

    return lines.join('\r\n')
  }

  enableStereoOpus = (section: string) => {
    let opusPayloadFormat = ''
    let lines = section.split('\r\n')

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('a=rtpmap:') && lines[i].toLowerCase().includes('opus/')) {
        opusPayloadFormat = lines[i].slice('a=rtpmap:'.length).split(' ')[0]
        break
      }
    }

    if (opusPayloadFormat === '') {
      return section
    }

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('a=fmtp:' + opusPayloadFormat + ' ')) {
        if (!lines[i].includes('stereo')) {
          lines[i] += ';stereo=1'
        }
        if (!lines[i].includes('sprop-stereo')) {
          lines[i] += ';sprop-stereo=1'
        }
      }
    }

    return lines.join('\r\n')
  }

  editOffer = (sdp: string) => {
    const sections = sdp.split('m=')

    for (let i = 0; i < sections.length; i++) {
      if (sections[i].startsWith('audio')) {
        sections[i] = this.enableStereoOpus(sections[i])

        if (this.nonAdvertisedCodecs.includes('pcma/8000/2')) {
          sections[i] = this.enableStereoPcmau(sections[i])
        }

        if (this.nonAdvertisedCodecs.includes('multiopus/48000/6')) {
          sections[i] = this.enableMultichannelOpus(sections[i])
        }

        if (this.nonAdvertisedCodecs.includes('L16/48000/2')) {
          sections[i] = this.enableL16(sections[i])
        }

        break
      }
    }

    return sections.join('m=')
  }

  generateSdpFragment = (od: any, candidates: any) => {
    const candidatesByMedia: any = {}
    for (const candidate of candidates) {
      const mid = candidate.sdpMLineIndex
      if (candidatesByMedia[mid] === undefined) {
        candidatesByMedia[mid] = []
      }
      candidatesByMedia[mid].push(candidate)
    }

    let frag = 'a=ice-ufrag:' + od.iceUfrag + '\r\n' + 'a=ice-pwd:' + od.icePwd + '\r\n'

    let mid = 0

    for (const media of od.medias) {
      if (candidatesByMedia[mid] !== undefined) {
        frag += 'm=' + media + '\r\n' + 'a=mid:' + mid + '\r\n'

        for (const candidate of candidatesByMedia[mid]) {
          frag += 'a=' + candidate.candidate + '\r\n'
        }
      }
      mid++
    }

    return frag
  }

  loadStream = () => {
    this.requestICEServers()
  }

  supportsNonAdvertisedCodec = (codec: string, fmtp: string) =>
    new Promise((resolve, reject) => {
      const pc = new RTCPeerConnection({ iceServers: [] })
      pc.addTransceiver('audio', { direction: 'recvonly' })
      pc.createOffer()
        .then(offer => {
          if (offer.sdp === undefined) {
            resolve(false)
            return
          }
          if (offer.sdp.includes(' ' + codec)) {
            // codec is advertised, there's no need to add it manually
            resolve(false)
            return
          }
          const sections = offer.sdp.split('m=audio')
          const lines = sections[1].split('\r\n')
          lines[0] += ' 118'
          lines.splice(lines.length - 1, 0, 'a=rtpmap:118 ' + codec)
          if (fmtp !== undefined) {
            lines.splice(lines.length - 1, 0, 'a=fmtp:118 ' + fmtp)
          }
          sections[1] = lines.join('\r\n')
          offer.sdp = sections.join('m=audio')
          return pc.setLocalDescription(offer)
        })
        .then(() => {
          return pc.setRemoteDescription(
            new RTCSessionDescription({
              type: 'answer',
              sdp:
                'v=0\r\n' +
                'o=- 6539324223450680508 0 IN IP4 0.0.0.0\r\n' +
                's=-\r\n' +
                't=0 0\r\n' +
                'a=fingerprint:sha-256 0D:9F:78:15:42:B5:4B:E6:E2:94:3E:5B:37:78:E1:4B:54:59:A3:36:3A:E5:05:EB:27:EE:8F:D2:2D:41:29:25\r\n' +
                'm=audio 9 UDP/TLS/RTP/SAVPF 118\r\n' +
                'c=IN IP4 0.0.0.0\r\n' +
                'a=ice-pwd:7c3bf4770007e7432ee4ea4d697db675\r\n' +
                'a=ice-ufrag:29e036dc\r\n' +
                'a=sendonly\r\n' +
                'a=rtcp-mux\r\n' +
                'a=rtpmap:118 ' +
                codec +
                '\r\n' +
                (fmtp !== undefined ? 'a=fmtp:118 ' + fmtp + '\r\n' : '')
            })
          )
        })
        .then(() => {
          resolve(true)
        })
        .catch(err => {
          resolve(false)
        })
        .finally(() => {
          pc.close()
        })
    })

  getNonAdvertisedCodecs = () => {
    Promise.all(
      [
        ['pcma/8000/2'],
        ['multiopus/48000/6', 'channel_mapping=0,4,1,2,3,5;num_streams=4;coupled_streams=2'],
        ['L16/48000/2']
      ].map(c => this.supportsNonAdvertisedCodec(c[0], c[1]).then(r => (r ? c[0] : false)))
    )
      .then(c => c.filter(e => e !== false))
      .then(codecs => {
        this.nonAdvertisedCodecs = codecs as string[]
        this.loadStream()
      })
  }

  onError = (err: Error) => {
    console.error('whep stream error', err)
    this.onOffline()
    this.online = false
    if (this.restartTimeout === null) {
      if (this.pc !== null) {
        this.pc.close()
        this.pc = null
      }

      this.restartTimeout = setTimeout(() => {
        this.restartTimeout = null
        this.loadStream()
      }, this.retryPause)

      if (this.sessionUrl) {
        fetch(this.sessionUrl, {
          method: 'DELETE'
        })
      }
      this.sessionUrl = ''

      this.queuedCandidates = []
    }
  }

  sendLocalCandidates(candidates: any) {
    fetch(this.sessionUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/trickle-ice-sdpfrag',
        'If-Match': '*'
      },
      body: this.generateSdpFragment(this.offerData, candidates)
    })
      .then(res => {
        switch (res.status) {
          case 204:
            break
          case 404:
            throw new Error('stream not found')
          default:
            throw new Error(`bad status code ${res.status}`)
        }
      })
      .catch(err => {
        this.onError(err.toString())
      })
  }

  onLocalCandidate(evt: any) {
    if (this.restartTimeout !== null) {
      return
    }

    if (evt.candidate !== null) {
      if (this.sessionUrl === '') {
        this.queuedCandidates.push(evt.candidate)
      } else {
        this.sendLocalCandidates([evt.candidate])
      }
    }
  }

  onRemoteAnswer(sdp: string) {
    if (this.restartTimeout !== null || this.pc === null) {
      return
    }

    this.pc
      .setRemoteDescription(
        new RTCSessionDescription({
          type: 'answer',
          sdp
        })
      )
      .then(() => {
        if (this.queuedCandidates.length !== 0) {
          this.sendLocalCandidates(this.queuedCandidates)
          this.queuedCandidates = []
        }
      })
      .catch(err => {
        this.onError(err.toString())
      })
  }

  sendOffer(offer: any) {
    fetch(this.whepUri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    })
      .then(res => {
        switch (res.status) {
          case 201:
            break
          case 404:
            throw new Error('stream not found')
          case 400:
            return res.json().then(e => {
              throw new Error(e.error)
            })
          default:
            throw new Error(`bad status code ${res.status}`)
        }
        this.sessionUrl = new URL(res.headers.get('location') as string, this.whepUri.replace('/whep', '/')).toString()
        console.log('session', this.sessionUrl)
        return res.text().then(sdp => this.onRemoteAnswer(sdp))
      })
      .catch(err => {
        this.onError(err.toString())
      })
  }

  createOffer = () => {
    if (this.pc) {
      this.pc
        .createOffer()
        .then(offer => {
          offer.sdp = this.editOffer(offer.sdp as string)
          this.offerData = this.parseOffer(offer.sdp)
          if (this.pc)
            this.pc
              .setLocalDescription(offer)
              .then(() => {
                this.sendOffer(offer)
              })
              .catch(err => {
                this.onError(err.toString())
              })
        })
        .catch(err => {
          this.onError(err.toString())
        })
    }
  }

  onConnectionState = () => {
    if (this.restartTimeout !== null) {
      return
    }

    if (this.pc?.iceConnectionState === 'disconnected') {
      this.onError(new Error('peer connection closed'))
    }
  }

  onTrack = (evt: RTCTrackEvent) => {
    this.video.srcObject = evt.streams[0]
    this.onOnline()
    this.online = true
  }

  requestICEServers = () => {
    fetch(this.whepUri, {
      method: 'OPTIONS'
    })
      .then(res => {
        this.pc = new RTCPeerConnection({
          iceServers: this.linkToIceServers(res.headers.get('Link') as string) as RTCIceServer[],
          // https://webrtc.org/getting-started/unified-plan-transition-guide
          // @ts-ignore
          sdpSemantics: 'unified-plan'
        })

        const direction = 'sendrecv'
        this.pc.addTransceiver('video', { direction })
        this.pc.addTransceiver('audio', { direction })

        this.pc.onicecandidate = evt => this.onLocalCandidate(evt)
        this.pc.oniceconnectionstatechange = () => this.onConnectionState()
        this.pc.ontrack = evt => this.onTrack(evt)

        this.createOffer()
      })
      .catch(err => {
        this.onError(err.toString())
      })
  }

  init = () => {
    this.getNonAdvertisedCodecs()
  }
}
