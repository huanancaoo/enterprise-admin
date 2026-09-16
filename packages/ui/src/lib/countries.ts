export interface Country {
  /** ISO 3166-1 alpha-2 代码（如 "CN", "US"） */
  code: string
  /** 标准英文名称（用作兜底与基础搜索） */
  name: string
  /** 常见别名与缩写（如 ["USA", "America", "美国"]） */
  aliases?: string[]
  /** 国际电话区号（如 "+1", "+86"，仅用于辅助搜索匹配） */
  callingCode?: string
}

/**
 * 官方 ISO 3166-1 alpha-2 完整国家与地区基准数据集（按英文名排序）
 */
export const COUNTRIES: readonly Country[] = [
  { code: "AF", name: "Afghanistan", aliases: ["阿富汗"], callingCode: "+93" },
  {
    code: "AX",
    name: "Åland Islands",
    aliases: ["奥兰群岛"],
    callingCode: "+358",
  },
  { code: "AL", name: "Albania", aliases: ["阿尔巴尼亚"], callingCode: "+355" },
  { code: "DZ", name: "Algeria", aliases: ["阿尔及利亚"], callingCode: "+213" },
  {
    code: "AS",
    name: "American Samoa",
    aliases: ["美属萨摩亚"],
    callingCode: "+1",
  },
  { code: "AD", name: "Andorra", aliases: ["安道尔"], callingCode: "+376" },
  { code: "AO", name: "Angola", aliases: ["安哥拉"], callingCode: "+244" },
  { code: "AI", name: "Anguilla", aliases: ["安圭拉"], callingCode: "+1" },
  { code: "AQ", name: "Antarctica", aliases: ["南极洲"], callingCode: "+672" },
  {
    code: "AG",
    name: "Antigua and Barbuda",
    aliases: ["安提瓜和巴布达"],
    callingCode: "+1",
  },
  { code: "AR", name: "Argentina", aliases: ["阿根廷"], callingCode: "+54" },
  { code: "AM", name: "Armenia", aliases: ["亚美尼亚"], callingCode: "+374" },
  { code: "AW", name: "Aruba", aliases: ["阿鲁巴"], callingCode: "+297" },
  {
    code: "AU",
    name: "Australia",
    aliases: ["澳大利亚", "澳洲"],
    callingCode: "+61",
  },
  { code: "AT", name: "Austria", aliases: ["奥地利"], callingCode: "+43" },
  {
    code: "AZ",
    name: "Azerbaijan",
    aliases: ["阿塞拜疆"],
    callingCode: "+994",
  },
  { code: "BS", name: "Bahamas", aliases: ["巴哈马"], callingCode: "+1" },
  { code: "BH", name: "Bahrain", aliases: ["巴林"], callingCode: "+973" },
  {
    code: "BD",
    name: "Bangladesh",
    aliases: ["孟加拉国"],
    callingCode: "+880",
  },
  { code: "BB", name: "Barbados", aliases: ["巴巴多斯"], callingCode: "+1" },
  { code: "BY", name: "Belarus", aliases: ["白俄罗斯"], callingCode: "+375" },
  { code: "BE", name: "Belgium", aliases: ["比利时"], callingCode: "+32" },
  { code: "BZ", name: "Belize", aliases: ["伯利兹"], callingCode: "+501" },
  { code: "BJ", name: "Benin", aliases: ["贝宁"], callingCode: "+229" },
  { code: "BM", name: "Bermuda", aliases: ["百慕大"], callingCode: "+1" },
  { code: "BT", name: "Bhutan", aliases: ["不丹"], callingCode: "+975" },
  { code: "BO", name: "Bolivia", aliases: ["玻利维亚"], callingCode: "+591" },
  {
    code: "BQ",
    name: "Bonaire, Sint Eustatius and Saba",
    aliases: ["波奈尔"],
    callingCode: "+599",
  },
  {
    code: "BA",
    name: "Bosnia and Herzegovina",
    aliases: ["波黑"],
    callingCode: "+387",
  },
  { code: "BW", name: "Botswana", aliases: ["博茨瓦纳"], callingCode: "+267" },
  { code: "BV", name: "Bouvet Island", aliases: ["布韦岛"] },
  {
    code: "BR",
    name: "Brazil",
    aliases: ["Brasil", "巴西"],
    callingCode: "+55",
  },
  {
    code: "IO",
    name: "British Indian Ocean Territory",
    aliases: ["英属印度洋领地"],
    callingCode: "+246",
  },
  { code: "BN", name: "Brunei", aliases: ["文莱"], callingCode: "+673" },
  { code: "BG", name: "Bulgaria", aliases: ["保加利亚"], callingCode: "+359" },
  {
    code: "BF",
    name: "Burkina Faso",
    aliases: ["布基纳法索"],
    callingCode: "+226",
  },
  { code: "BI", name: "Burundi", aliases: ["布隆迪"], callingCode: "+257" },
  { code: "CV", name: "Cabo Verde", aliases: ["佛得角"], callingCode: "+238" },
  { code: "KH", name: "Cambodia", aliases: ["柬埔寨"], callingCode: "+855" },
  { code: "CM", name: "Cameroon", aliases: ["喀麦隆"], callingCode: "+237" },
  { code: "CA", name: "Canada", aliases: ["加拿大"], callingCode: "+1" },
  {
    code: "KY",
    name: "Cayman Islands",
    aliases: ["开曼群岛"],
    callingCode: "+1",
  },
  {
    code: "CF",
    name: "Central African Republic",
    aliases: ["中非共和国"],
    callingCode: "+236",
  },
  { code: "TD", name: "Chad", aliases: ["乍得"], callingCode: "+235" },
  { code: "CL", name: "Chile", aliases: ["智利"], callingCode: "+56" },
  { code: "CN", name: "China", aliases: ["PRC", "中国"], callingCode: "+86" },
  {
    code: "CX",
    name: "Christmas Island",
    aliases: ["圣诞岛"],
    callingCode: "+61",
  },
  {
    code: "CC",
    name: "Cocos (Keeling) Islands",
    aliases: ["科科斯群岛"],
    callingCode: "+61",
  },
  { code: "CO", name: "Colombia", aliases: ["哥伦比亚"], callingCode: "+57" },
  { code: "KM", name: "Comoros", aliases: ["科摩罗"], callingCode: "+269" },
  { code: "CD", name: "Congo (DRC)", aliases: ["刚果金"], callingCode: "+243" },
  { code: "CG", name: "Congo", aliases: ["刚果布"], callingCode: "+242" },
  {
    code: "CK",
    name: "Cook Islands",
    aliases: ["库克群岛"],
    callingCode: "+682",
  },
  {
    code: "CR",
    name: "Costa Rica",
    aliases: ["哥斯达黎加"],
    callingCode: "+506",
  },
  {
    code: "CI",
    name: "Côte d'Ivoire",
    aliases: ["科特迪瓦"],
    callingCode: "+225",
  },
  { code: "HR", name: "Croatia", aliases: ["克罗地亚"], callingCode: "+385" },
  { code: "CU", name: "Cuba", aliases: ["古巴"], callingCode: "+53" },
  { code: "CW", name: "Curaçao", aliases: ["库拉索"], callingCode: "+599" },
  { code: "CY", name: "Cyprus", aliases: ["塞浦路斯"], callingCode: "+357" },
  {
    code: "CZ",
    name: "Czech Republic",
    aliases: ["Czechia", "捷克"],
    callingCode: "+420",
  },
  { code: "DK", name: "Denmark", aliases: ["丹麦"], callingCode: "+45" },
  { code: "DJ", name: "Djibouti", aliases: ["吉布提"], callingCode: "+253" },
  { code: "DM", name: "Dominica", aliases: ["多米尼克"], callingCode: "+1" },
  {
    code: "DO",
    name: "Dominican Republic",
    aliases: ["多米尼加"],
    callingCode: "+1",
  },
  { code: "EC", name: "Ecuador", aliases: ["厄瓜多尔"], callingCode: "+593" },
  { code: "EG", name: "Egypt", aliases: ["埃及"], callingCode: "+20" },
  {
    code: "SV",
    name: "El Salvador",
    aliases: ["萨尔瓦多"],
    callingCode: "+503",
  },
  {
    code: "GQ",
    name: "Equatorial Guinea",
    aliases: ["赤道几内亚"],
    callingCode: "+240",
  },
  { code: "ER", name: "Eritrea", aliases: ["厄立特里亚"], callingCode: "+291" },
  { code: "EE", name: "Estonia", aliases: ["爱沙尼亚"], callingCode: "+372" },
  { code: "SZ", name: "Eswatini", aliases: ["斯威士兰"], callingCode: "+268" },
  {
    code: "ET",
    name: "Ethiopia",
    aliases: ["埃塞俄比亚"],
    callingCode: "+251",
  },
  {
    code: "FK",
    name: "Falkland Islands",
    aliases: ["马尔维纳斯群岛"],
    callingCode: "+500",
  },
  {
    code: "FO",
    name: "Faroe Islands",
    aliases: ["法罗群岛"],
    callingCode: "+298",
  },
  { code: "FJ", name: "Fiji", aliases: ["斐济"], callingCode: "+679" },
  { code: "FI", name: "Finland", aliases: ["芬兰"], callingCode: "+358" },
  { code: "FR", name: "France", aliases: ["法国"], callingCode: "+33" },
  {
    code: "GF",
    name: "French Guiana",
    aliases: ["法属圭亚那"],
    callingCode: "+594",
  },
  {
    code: "PF",
    name: "French Polynesia",
    aliases: ["法属波利尼西亚"],
    callingCode: "+689",
  },
  {
    code: "TF",
    name: "French Southern Territories",
    aliases: ["法属南部领地"],
  },
  { code: "GA", name: "Gabon", aliases: ["加蓬"], callingCode: "+241" },
  { code: "GM", name: "Gambia", aliases: ["冈比亚"], callingCode: "+220" },
  { code: "GE", name: "Georgia", aliases: ["格鲁吉亚"], callingCode: "+995" },
  {
    code: "DE",
    name: "Germany",
    aliases: ["Deutschland", "德国"],
    callingCode: "+49",
  },
  { code: "GH", name: "Ghana", aliases: ["加纳"], callingCode: "+233" },
  { code: "GI", name: "Gibraltar", aliases: ["直布罗陀"], callingCode: "+350" },
  { code: "GR", name: "Greece", aliases: ["希腊"], callingCode: "+30" },
  { code: "GL", name: "Greenland", aliases: ["格陵兰"], callingCode: "+299" },
  { code: "GD", name: "Grenada", aliases: ["格林纳达"], callingCode: "+1" },
  {
    code: "GP",
    name: "Guadeloupe",
    aliases: ["瓜德罗普"],
    callingCode: "+590",
  },
  { code: "GU", name: "Guam", aliases: ["关岛"], callingCode: "+1" },
  { code: "GT", name: "Guatemala", aliases: ["危地马拉"], callingCode: "+502" },
  { code: "GG", name: "Guernsey", aliases: ["根西岛"], callingCode: "+44" },
  { code: "GN", name: "Guinea", aliases: ["几内亚"], callingCode: "+224" },
  {
    code: "GW",
    name: "Guinea-Bissau",
    aliases: ["几内亚比绍"],
    callingCode: "+245",
  },
  { code: "GY", name: "Guyana", aliases: ["圭亚那"], callingCode: "+592" },
  { code: "HT", name: "Haiti", aliases: ["海地"], callingCode: "+509" },
  {
    code: "HM",
    name: "Heard Island and McDonald Islands",
    aliases: ["赫德岛和麦克唐纳群岛"],
  },
  {
    code: "VA",
    name: "Vatican City",
    aliases: ["Holy See", "梵蒂冈"],
    callingCode: "+39",
  },
  { code: "HN", name: "Honduras", aliases: ["洪都拉斯"], callingCode: "+504" },
  {
    code: "HK",
    name: "Hong Kong",
    aliases: ["香港", "中国香港"],
    callingCode: "+852",
  },
  { code: "HU", name: "Hungary", aliases: ["匈牙利"], callingCode: "+36" },
  { code: "IS", name: "Iceland", aliases: ["冰岛"], callingCode: "+354" },
  {
    code: "IN",
    name: "India",
    aliases: ["印度", "Bharat"],
    callingCode: "+91",
  },
  {
    code: "ID",
    name: "Indonesia",
    aliases: ["印度尼西亚", "印尼"],
    callingCode: "+62",
  },
  { code: "IR", name: "Iran", aliases: ["伊朗"], callingCode: "+98" },
  { code: "IQ", name: "Iraq", aliases: ["伊拉克"], callingCode: "+964" },
  { code: "IE", name: "Ireland", aliases: ["爱尔兰"], callingCode: "+353" },
  { code: "IM", name: "Isle of Man", aliases: ["曼岛"], callingCode: "+44" },
  { code: "IL", name: "Israel", aliases: ["以色列"], callingCode: "+972" },
  {
    code: "IT",
    name: "Italy",
    aliases: ["Italia", "意大利"],
    callingCode: "+39",
  },
  { code: "JM", name: "Jamaica", aliases: ["牙买加"], callingCode: "+1" },
  { code: "JP", name: "Japan", aliases: ["日本"], callingCode: "+81" },
  { code: "JE", name: "Jersey", aliases: ["泽西岛"], callingCode: "+44" },
  { code: "JO", name: "Jordan", aliases: ["约旦"], callingCode: "+962" },
  {
    code: "KZ",
    name: "Kazakhstan",
    aliases: ["哈萨克斯坦"],
    callingCode: "+7",
  },
  { code: "KE", name: "Kenya", aliases: ["肯尼亚"], callingCode: "+254" },
  { code: "KI", name: "Kiribati", aliases: ["基里巴斯"], callingCode: "+686" },
  {
    code: "KP",
    name: "North Korea",
    aliases: ["朝鲜", "DPRK"],
    callingCode: "+850",
  },
  {
    code: "KR",
    name: "South Korea",
    aliases: ["韩国", "ROK"],
    callingCode: "+82",
  },
  { code: "KW", name: "Kuwait", aliases: ["科威特"], callingCode: "+965" },
  {
    code: "KG",
    name: "Kyrgyzstan",
    aliases: ["吉尔吉斯斯坦"],
    callingCode: "+996",
  },
  { code: "LA", name: "Laos", aliases: ["老挝"], callingCode: "+856" },
  { code: "LV", name: "Latvia", aliases: ["拉脱维亚"], callingCode: "+371" },
  { code: "LB", name: "Lebanon", aliases: ["黎巴嫩"], callingCode: "+961" },
  { code: "LS", name: "Lesotho", aliases: ["莱索托"], callingCode: "+266" },
  { code: "LR", name: "Liberia", aliases: ["利比里亚"], callingCode: "+231" },
  { code: "LY", name: "Libya", aliases: ["利比亚"], callingCode: "+218" },
  {
    code: "LI",
    name: "Liechtenstein",
    aliases: ["列支敦士登"],
    callingCode: "+423",
  },
  { code: "LT", name: "Lithuania", aliases: ["立陶宛"], callingCode: "+370" },
  { code: "LU", name: "Luxembourg", aliases: ["卢森堡"], callingCode: "+352" },
  {
    code: "MO",
    name: "Macau",
    aliases: ["Macao", "澳门", "中国澳门"],
    callingCode: "+853",
  },
  {
    code: "MG",
    name: "Madagascar",
    aliases: ["马达加斯加"],
    callingCode: "+261",
  },
  { code: "MW", name: "Malawi", aliases: ["马拉维"], callingCode: "+265" },
  { code: "MY", name: "Malaysia", aliases: ["马来西亚"], callingCode: "+60" },
  { code: "MV", name: "Maldives", aliases: ["马尔代夫"], callingCode: "+960" },
  { code: "ML", name: "Mali", aliases: ["马里"], callingCode: "+223" },
  { code: "MT", name: "Malta", aliases: ["马耳他"], callingCode: "+356" },
  {
    code: "MH",
    name: "Marshall Islands",
    aliases: ["马绍尔群岛"],
    callingCode: "+692",
  },
  {
    code: "MQ",
    name: "Martinique",
    aliases: ["马提尼克"],
    callingCode: "+596",
  },
  {
    code: "MR",
    name: "Mauritania",
    aliases: ["毛里塔尼亚"],
    callingCode: "+222",
  },
  { code: "MU", name: "Mauritius", aliases: ["毛里求斯"], callingCode: "+230" },
  { code: "YT", name: "Mayotte", aliases: ["马约特"], callingCode: "+262" },
  { code: "MX", name: "Mexico", aliases: ["墨西哥"], callingCode: "+52" },
  {
    code: "FM",
    name: "Micronesia",
    aliases: ["密克罗尼西亚"],
    callingCode: "+691",
  },
  { code: "MD", name: "Moldova", aliases: ["摩尔多瓦"], callingCode: "+373" },
  { code: "MC", name: "Monaco", aliases: ["摩纳哥"], callingCode: "+377" },
  { code: "MN", name: "Mongolia", aliases: ["蒙古"], callingCode: "+976" },
  { code: "ME", name: "Montenegro", aliases: ["黑山"], callingCode: "+382" },
  {
    code: "MS",
    name: "Montserrat",
    aliases: ["蒙特塞拉特"],
    callingCode: "+1",
  },
  { code: "MA", name: "Morocco", aliases: ["摩洛哥"], callingCode: "+212" },
  {
    code: "MZ",
    name: "Mozambique",
    aliases: ["莫桑比克"],
    callingCode: "+258",
  },
  {
    code: "MM",
    name: "Myanmar",
    aliases: ["Burma", "缅甸"],
    callingCode: "+95",
  },
  { code: "NA", name: "Namibia", aliases: ["纳米比亚"], callingCode: "+264" },
  { code: "NR", name: "Nauru", aliases: ["瑙鲁"], callingCode: "+674" },
  { code: "NP", name: "Nepal", aliases: ["尼泊尔"], callingCode: "+977" },
  {
    code: "NL",
    name: "Netherlands",
    aliases: ["Holland", "荷兰"],
    callingCode: "+31",
  },
  {
    code: "NC",
    name: "New Caledonia",
    aliases: ["新喀里多尼亚"],
    callingCode: "+687",
  },
  { code: "NZ", name: "New Zealand", aliases: ["新西兰"], callingCode: "+64" },
  { code: "NI", name: "Nicaragua", aliases: ["尼加拉瓜"], callingCode: "+505" },
  { code: "NE", name: "Niger", aliases: ["尼日尔"], callingCode: "+227" },
  { code: "NG", name: "Nigeria", aliases: ["尼日利亚"], callingCode: "+234" },
  { code: "NU", name: "Niue", aliases: ["纽埃"], callingCode: "+683" },
  {
    code: "NF",
    name: "Norfolk Island",
    aliases: ["诺福克岛"],
    callingCode: "+672",
  },
  {
    code: "MK",
    name: "North Macedonia",
    aliases: ["北马其顿"],
    callingCode: "+389",
  },
  {
    code: "MP",
    name: "Northern Mariana Islands",
    aliases: ["北马里亚纳群岛"],
    callingCode: "+1",
  },
  { code: "NO", name: "Norway", aliases: ["挪威"], callingCode: "+47" },
  { code: "OM", name: "Oman", aliases: ["阿曼"], callingCode: "+968" },
  { code: "PK", name: "Pakistan", aliases: ["巴基斯坦"], callingCode: "+92" },
  { code: "PW", name: "Palau", aliases: ["帕劳"], callingCode: "+680" },
  { code: "PS", name: "Palestine", aliases: ["巴勒斯坦"], callingCode: "+970" },
  { code: "PA", name: "Panama", aliases: ["巴拿马"], callingCode: "+507" },
  {
    code: "PG",
    name: "Papua New Guinea",
    aliases: ["巴布亚新几内亚"],
    callingCode: "+675",
  },
  { code: "PY", name: "Paraguay", aliases: ["巴拉圭"], callingCode: "+595" },
  { code: "PE", name: "Peru", aliases: ["秘鲁"], callingCode: "+51" },
  { code: "PH", name: "Philippines", aliases: ["菲律宾"], callingCode: "+63" },
  {
    code: "PN",
    name: "Pitcairn Islands",
    aliases: ["皮特凯恩群岛"],
    callingCode: "+64",
  },
  { code: "PL", name: "Poland", aliases: ["波兰"], callingCode: "+48" },
  { code: "PT", name: "Portugal", aliases: ["葡萄牙"], callingCode: "+351" },
  { code: "PR", name: "Puerto Rico", aliases: ["波多黎各"], callingCode: "+1" },
  { code: "QA", name: "Qatar", aliases: ["卡塔尔"], callingCode: "+974" },
  { code: "RE", name: "Réunion", aliases: ["留尼汪"], callingCode: "+262" },
  { code: "RO", name: "Romania", aliases: ["罗马尼亚"], callingCode: "+40" },
  { code: "RU", name: "Russia", aliases: ["俄罗斯"], callingCode: "+7" },
  { code: "RW", name: "Rwanda", aliases: ["卢旺达"], callingCode: "+250" },
  {
    code: "BL",
    name: "Saint Barthélemy",
    aliases: ["圣巴泰勒米"],
    callingCode: "+590",
  },
  {
    code: "SH",
    name: "Saint Helena",
    aliases: ["圣赫勒拿"],
    callingCode: "+290",
  },
  {
    code: "KN",
    name: "Saint Kitts and Nevis",
    aliases: ["圣基茨和尼维斯"],
    callingCode: "+1",
  },
  { code: "LC", name: "Saint Lucia", aliases: ["圣卢西亚"], callingCode: "+1" },
  {
    code: "MF",
    name: "Saint Martin",
    aliases: ["法属圣马丁"],
    callingCode: "+590",
  },
  {
    code: "PM",
    name: "Saint Pierre and Miquelon",
    aliases: ["圣皮埃尔和密克隆"],
    callingCode: "+508",
  },
  {
    code: "VC",
    name: "Saint Vincent and the Grenadines",
    aliases: ["圣文森特和格林纳丁斯"],
    callingCode: "+1",
  },
  { code: "WS", name: "Samoa", aliases: ["萨摩亚"], callingCode: "+685" },
  {
    code: "SM",
    name: "San Marino",
    aliases: ["圣马力诺"],
    callingCode: "+378",
  },
  {
    code: "ST",
    name: "Sao Tome and Principe",
    aliases: ["圣多美和普林西比"],
    callingCode: "+239",
  },
  {
    code: "SA",
    name: "Saudi Arabia",
    aliases: ["沙特阿拉伯", "沙特"],
    callingCode: "+966",
  },
  { code: "SN", name: "Senegal", aliases: ["塞内加尔"], callingCode: "+221" },
  { code: "RS", name: "Serbia", aliases: ["塞尔维亚"], callingCode: "+381" },
  { code: "SC", name: "Seychelles", aliases: ["塞舌尔"], callingCode: "+248" },
  {
    code: "SL",
    name: "Sierra Leone",
    aliases: ["塞拉利昂"],
    callingCode: "+232",
  },
  {
    code: "SG",
    name: "Singapore",
    aliases: ["新加坡", "狮城"],
    callingCode: "+65",
  },
  {
    code: "SX",
    name: "Sint Maarten",
    aliases: ["荷属圣马丁"],
    callingCode: "+1",
  },
  { code: "SK", name: "Slovakia", aliases: ["斯洛伐克"], callingCode: "+421" },
  {
    code: "SI",
    name: "Slovenia",
    aliases: ["斯洛文尼亚"],
    callingCode: "+386",
  },
  {
    code: "SB",
    name: "Solomon Islands",
    aliases: ["所罗门群岛"],
    callingCode: "+677",
  },
  { code: "SO", name: "Somalia", aliases: ["索马里"], callingCode: "+252" },
  { code: "ZA", name: "South Africa", aliases: ["南非"], callingCode: "+27" },
  {
    code: "GS",
    name: "South Georgia and the South Sandwich Islands",
    aliases: ["南乔治亚和南桑威奇群岛"],
  },
  { code: "SS", name: "South Sudan", aliases: ["南苏丹"], callingCode: "+211" },
  {
    code: "ES",
    name: "Spain",
    aliases: ["España", "西班牙"],
    callingCode: "+34",
  },
  { code: "LK", name: "Sri Lanka", aliases: ["斯里兰卡"], callingCode: "+94" },
  { code: "SD", name: "Sudan", aliases: ["苏丹"], callingCode: "+249" },
  { code: "SR", name: "Suriname", aliases: ["苏里南"], callingCode: "+597" },
  {
    code: "SJ",
    name: "Svalbard and Jan Mayen",
    aliases: ["斯瓦尔巴和扬马延"],
    callingCode: "+47",
  },
  { code: "SE", name: "Sweden", aliases: ["瑞典"], callingCode: "+46" },
  { code: "CH", name: "Switzerland", aliases: ["瑞士"], callingCode: "+41" },
  { code: "SY", name: "Syria", aliases: ["叙利亚"], callingCode: "+963" },
  {
    code: "TW",
    name: "Taiwan",
    aliases: ["台湾", "中国台湾"],
    callingCode: "+886",
  },
  {
    code: "TJ",
    name: "Tajikistan",
    aliases: ["塔吉克斯坦"],
    callingCode: "+992",
  },
  { code: "TZ", name: "Tanzania", aliases: ["坦桑尼亚"], callingCode: "+255" },
  { code: "TH", name: "Thailand", aliases: ["泰国"], callingCode: "+66" },
  { code: "TL", name: "Timor-Leste", aliases: ["东帝汶"], callingCode: "+670" },
  { code: "TG", name: "Togo", aliases: ["多哥"], callingCode: "+228" },
  { code: "TK", name: "Tokelau", aliases: ["托克劳"], callingCode: "+690" },
  { code: "TO", name: "Tonga", aliases: ["汤加"], callingCode: "+676" },
  {
    code: "TT",
    name: "Trinidad and Tobago",
    aliases: ["特立尼达和多巴哥"],
    callingCode: "+1",
  },
  { code: "TN", name: "Tunisia", aliases: ["突尼斯"], callingCode: "+216" },
  {
    code: "TR",
    name: "Turkey",
    aliases: ["Türkiye", "土耳其"],
    callingCode: "+90",
  },
  {
    code: "TM",
    name: "Turkmenistan",
    aliases: ["土库曼斯坦"],
    callingCode: "+993",
  },
  {
    code: "TC",
    name: "Turks and Caicos Islands",
    aliases: ["特克斯和凯科斯群岛"],
    callingCode: "+1",
  },
  { code: "TV", name: "Tuvalu", aliases: ["图瓦卢"], callingCode: "+688" },
  { code: "UG", name: "Uganda", aliases: ["乌干达"], callingCode: "+256" },
  { code: "UA", name: "Ukraine", aliases: ["乌克兰"], callingCode: "+380" },
  {
    code: "AE",
    name: "United Arab Emirates",
    aliases: ["UAE", "阿联酋", "阿拉伯联合酋长国"],
    callingCode: "+971",
  },
  {
    code: "GB",
    name: "United Kingdom",
    aliases: ["UK", "Great Britain", "Britain", "England", "英国"],
    callingCode: "+44",
  },
  {
    code: "US",
    name: "United States",
    aliases: ["USA", "America", "United States of America", "美国"],
    callingCode: "+1",
  },
  {
    code: "UM",
    name: "United States Minor Outlying Islands",
    aliases: ["美国本土外小岛屿"],
  },
  { code: "UY", name: "Uruguay", aliases: ["乌拉圭"], callingCode: "+598" },
  {
    code: "UZ",
    name: "Uzbekistan",
    aliases: ["乌兹别克斯坦"],
    callingCode: "+998",
  },
  { code: "VU", name: "Vanuatu", aliases: ["瓦努阿图"], callingCode: "+678" },
  { code: "VE", name: "Venezuela", aliases: ["委内瑞拉"], callingCode: "+58" },
  { code: "VN", name: "Vietnam", aliases: ["越南"], callingCode: "+84" },
  {
    code: "VG",
    name: "Virgin Islands (British)",
    aliases: ["英属维尔京群岛"],
    callingCode: "+1",
  },
  {
    code: "VI",
    name: "Virgin Islands (U.S.)",
    aliases: ["美属维尔京群岛"],
    callingCode: "+1",
  },
  {
    code: "WF",
    name: "Wallis and Futuna",
    aliases: ["瓦利斯和富图纳"],
    callingCode: "+681",
  },
  {
    code: "EH",
    name: "Western Sahara",
    aliases: ["西撒哈拉"],
    callingCode: "+212",
  },
  { code: "YE", name: "Yemen", aliases: ["也门"], callingCode: "+967" },
  { code: "ZM", name: "Zambia", aliases: ["赞比亚"], callingCode: "+260" },
  { code: "ZW", name: "Zimbabwe", aliases: ["津巴布韦"], callingCode: "+263" },
]

export const COUNTRY_MAP: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((c) => [c.code, c])
)

/**
 * 将 ISO 3166-1 alpha-2 字符串转换为 Unicode 国旗 Emoji
 * （注意：Windows 默认字体不支持将 Regional Indicator 字符对渲染为国旗图标，因此国旗仅作为可选视觉增强）
 */
export function getCountryFlag(code: string): string {
  if (!code || code.length !== 2) return ""
  const upper = code.toUpperCase()
  const first = upper.charCodeAt(0)
  const second = upper.charCodeAt(1)
  if (first < 65 || first > 90 || second < 65 || second > 90) return ""
  return String.fromCodePoint(127397 + first, 127397 + second)
}

const displayNamesCache = new Map<string, Intl.DisplayNames>()

/**
 * 利用浏览器原生 Intl.DisplayNames 获取对应 locale 下的国家/地区本地化名称
 * 如果当前环境不支持或未找到翻译，平滑兜底至内置英文名称或原始代码。
 */
export function getCountryName(code: string, locale?: string): string {
  if (!code) return ""
  const normalizedCode = code.toUpperCase()
  const activeLocale = locale || "en"

  try {
    let dn = displayNamesCache.get(activeLocale)
    if (!dn) {
      dn = new Intl.DisplayNames([activeLocale], { type: "region" })
      displayNamesCache.set(activeLocale, dn)
    }
    const localized = dn.of(normalizedCode)
    if (localized && localized !== normalizedCode) {
      return localized
    }
  } catch {
    // 捕获非法 locale 或缺失实现的环境
  }

  const fallback = COUNTRY_MAP.get(normalizedCode)
  return fallback?.name ?? normalizedCode
}

/**
 * 多维度搜索匹配逻辑：
 * 支持按 ISO Code、本地化名、英文官方名、别名、国际电话区号进行模糊命中。
 */
export function matchCountry(
  country: Country,
  search: string,
  localizedName: string
): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true

  // 1. ISO Code 严格或前缀匹配
  if (country.code.toLowerCase().includes(query)) return true

  // 2. 本地化名称匹配（如 "中国", "美国", "كندا"）
  if (localizedName.toLowerCase().includes(query)) return true

  // 3. 英文名匹配（如 "United States", "China"）
  if (country.name.toLowerCase().includes(query)) return true

  // 4. 国际电话区号匹配（如 "+1", "1", "+86", "86"）
  if (country.callingCode) {
    if (country.callingCode.includes(query)) return true
    const cleanCalling = country.callingCode.replace(/\D/g, "")
    const cleanQuery = query.replace(/\D/g, "")
    if (cleanQuery && cleanCalling.includes(cleanQuery)) return true
  }

  // 5. 别名匹配（如 "USA", "America"）
  if (country.aliases) {
    for (const alias of country.aliases) {
      if (alias.toLowerCase().includes(query)) return true
    }
  }

  return false
}
