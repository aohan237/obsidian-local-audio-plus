declare module "http-proxy-agent" {
  export class HttpProxyAgent<T = string> {
    constructor(proxy: string | URL);
  }
}

declare module "https-proxy-agent" {
  export class HttpsProxyAgent<T = string> {
    constructor(proxy: string | URL);
  }
}

declare module "socks-proxy-agent" {
  export class SocksProxyAgent {
    constructor(proxy: string | URL);
  }
}
