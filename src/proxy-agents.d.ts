declare module "http-proxy-agent" {
  export class HttpProxyAgent {
    constructor(proxy: string | URL);
  }
}

declare module "https-proxy-agent" {
  export class HttpsProxyAgent {
    constructor(proxy: string | URL);
  }
}

declare module "socks-proxy-agent" {
  export class SocksProxyAgent {
    constructor(proxy: string | URL);
  }
}
