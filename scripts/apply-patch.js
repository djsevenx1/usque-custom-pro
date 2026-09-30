#!/usr/bin/env node

/**
 * 自动应用 Google Play 商店修复与网络稳定性优化补丁 (Idempotent Patch Script)
 *
 * 补丁核心修复项：
 * 1. 规则集补齐：在 CLASH_DOMAIN_RULESETS 中补齐缺失的 google.mrs 规则集；
 * 2. 规则路由置顶：在 rules: 中显式置顶 Google Play 核心 CDN 域名 (gvt1/2/3, services.googleapis.cn, 1e100.net 等) 与 google 规则集，防止流量误走直连；
 * 3. 关闭 IPv6 死锁：将全局及 DNS 的 ipv6: true 设为 false，防止 Android 系统下载器 IPv6 握手黑洞；
 * 4. DNS 增强：注入 1.1.1.1 / dns.google DoH 及 nameserver-policy，防止国内 DNS 返回污染或断流；
 * 5. 测速与连接稳定性：将过于敏感的 tolerance 10/20ms 提升至 50ms，interval 提升至 300s，防止大文件下载途中断流跳节点。
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const targetFiles = [
  path.join(repoRoot, 'pages', 'app.js'),
  path.join(repoRoot, 'workers', 'public', 'app.js')
];

let modifiedCount = 0;

for (const filePath of targetFiles) {
  if (!fs.existsSync(filePath)) {
    console.log(`[跳过] 文件不存在: ${path.relative(repoRoot, filePath)}`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. 补齐 CLASH_DOMAIN_RULESETS 中的 google 规则集
  if (!content.includes('["google","https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs"]')) {
    content = content.replace(
      '["youtube","https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs"],',
      '["youtube","https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs"],\n  ["google","https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs"],'
    );
  }

  // 2. 补齐 lite 模式中的 google 规则集与路由
  if (content.includes('if(o.ruleMode==="lite"){') && !content.includes('RULE-SET,google,🚀 节点选择')) {
    content = content.replace(
      '    a.push(\n      "  youtube:","    type: http","    behavior: domain","    format: mrs","    interval: 43200",\n      "    url: https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs"\n    );',
      '    a.push(\n      "  google:","    type: http","    behavior: domain","    format: mrs","    interval: 43200",\n      "    url: https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs"\n    );\n    if(freeOn&&o.freeUseWarp)a.push(\'    proxy: "WARP中转"\');\n    a.push(\n      "  youtube:","    type: http","    behavior: domain","    format: mrs","    interval: 43200",\n      "    url: https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs"\n    );'
    );
    content = content.replace(
      '      "  - RULE-SET,youtube,▶️ YouTube高速",',
      '      "  - DOMAIN-SUFFIX,services.googleapis.cn,🚀 节点选择",\n      "  - DOMAIN-SUFFIX,gvt1.com,🚀 节点选择",\n      "  - DOMAIN-SUFFIX,gvt2.com,🚀 节点选择",\n      "  - DOMAIN-SUFFIX,1e100.net,🚀 节点选择",\n      "  - RULE-SET,google,🚀 节点选择",\n      "  - RULE-SET,youtube,▶️ YouTube高速",'
    );
  }

  // 3. 补齐标准模式 rules: 中的 Google Play 核心 CDN 与规则路由
  if (!content.includes('DOMAIN-SUFFIX,services.googleapis.cn,🚀 节点选择')) {
    const targetAnchor = '"  # Mainland / local",';
    const replacement = `"",
    "  # Google & Google Play Store (Auto-Patched)",
    "  - DOMAIN-SUFFIX,services.googleapis.cn,🚀 节点选择",
    "  - DOMAIN-SUFFIX,gvt1.com,🚀 节点选择",
    "  - DOMAIN-SUFFIX,gvt2.com,🚀 节点选择",
    "  - DOMAIN-SUFFIX,gvt3.com,🚀 节点选择",
    "  - DOMAIN-SUFFIX,1e100.net,🚀 节点选择",
    "  - DOMAIN-SUFFIX,play.google.com,🚀 节点选择",
    "  - DOMAIN-SUFFIX,play.googleapis.com,🚀 节点选择",
    "  - DOMAIN-SUFFIX,xn--ngstr-lra8j.com,🚀 节点选择",
    "  - RULE-SET,google,🚀 节点选择",
    "",
    "  # Mainland / local",`;
    content = content.replace(targetAnchor, replacement);
  }

  // 4. 关闭全局 ipv6: true 避免 Android 下载通道死锁
  content = content.replaceAll('"ipv6: true"', '"ipv6: false"');
  content = content.replaceAll('"  ipv6: true"', '"  ipv6: false"');

  // 5. 增强 DNS 配置（禁用 DNS IPv6，扩展海外安全 DoH 与策略分流）
  const oldNameserverSnippet = '"  nameserver:","    - https://doh.pub/dns-query","    - https://dns.alidns.com/dns-query",\n  "","proxies:"';
  const newNameserverSnippet = `"  nameserver:","    - https://doh.pub/dns-query","    - https://dns.alidns.com/dns-query","    - https://1.1.1.1/dns-query","    - https://dns.google/dns-query",
  "  proxy-server-nameserver:","    - 223.5.5.5","    - 1.1.1.1",
  "  nameserver-policy:",'    "geosite:google": "https://dns.google/dns-query"',
  '    "geosite:geolocation-!cn": "https://1.1.1.1/dns-query"',
  '    "geosite:cn": ["https://doh.pub/dns-query","https://dns.alidns.com/dns-query"]',
  "","proxies:"`;
  if (!content.includes('https://dns.google/dns-query') && content.includes(oldNameserverSnippet)) {
    content = content.replace(oldNameserverSnippet, newNameserverSnippet);
  }

  // 6. 提高测速容差与间隔，避免频繁切节点导致 Google Play 下载中途断流重置
  content = content.replaceAll(
    '"    interval: 60","    tolerance: 10"',
    '"    interval: 300","    tolerance: 50"'
  );
  content = content.replaceAll(
    '"    interval: 120","    tolerance: 20"',
    '"    interval: 300","    tolerance: 50"'
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[成功修复] 已成功注入补丁: ${path.relative(repoRoot, filePath)}`);
    modifiedCount++;
  } else {
    console.log(`[保持最新] 无需重复应用: ${path.relative(repoRoot, filePath)}`);
  }
}

console.log(`\n补丁执行完毕！共修改 ${modifiedCount} 个文件。`);
