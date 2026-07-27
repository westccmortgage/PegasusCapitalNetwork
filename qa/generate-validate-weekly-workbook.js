#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const pkg = require("exceljs/package.json");
const core = require("../netlify/functions/lib/intelligence-import-core.js");
const { buildTemplate } = require("../netlify/functions/lib/intelligence-workbook.js");
const preview = require("../netlify/functions/intelligence-import-preview.js");

const payload = JSON.parse(zlib.gunzipSync(Buffer.from("H4sIAEWQZ2oC/+1d6XLjyJF+lQpFz3gdRvE+xFY4dihK6uY0dZhUd+/Y4egAyRIJCwQ4OKRmex3hh9g/+3p+ks3MOlAAQVLqY2xPrCM8TZEgUJWZX96V/OuRG38I745eHjVqjQ6vdXmje+Qczd3EjUUSH73869FNFK5FlHgC/vrTn45G19c3V+e3vFU77rTrdPWN+4nd+O4nF143m7U6e89Ow02QhAE7Fe5syU79hzl8lnsT/r4Y0RdazQ7dxF+ZT2rHvNXkrTZv1nitzmuwrlqtXjtygtT35X+OroS3WE7DaBmGczZJIm/NxiJxPf/IqbdatZpTr9R7Tr3XqzntTg3/5zQ79Qb806m02k4dXsgb9S8ng+tbVmXvvNn9hp269yLawCIGru+zuzBi13d3IorZP/7+P6yfLtI4YfWmw5BgcNUySdbxy2r18fGx4ofhOhBJZRauqiMvTrxgUUWC8Pdc7Z3TDjkSpPDWxaiqSVqF20p2dDhuOsebXhtWPEvYVfgIn4zFOowSMX/JXrQrnUuH1VsO7J1NLhz2ArbrwH7Z1fXQYbjp79jMXTM3mDPY/XfMF8DkOQOOjGDhV7Bw3Ko381yfXbrRLI3Zyo3uBe6DRfSkGK4W7MGducFs47A4ZLM0ikSQsHA2S9f4LlshhaZwlYi8O0/MK+wcSLFyYZnMTVgHljG6feewbqXR/g7o2GYb4UbxS1hYkMKj52KasFhED95MwCbqbafbaMhVV+qtj+xsMhifwOtG+yOL07VcljsN0wSurjSbl+w/2r2KfMpvYUuPAXBv6a0dto48YGfs+oJuF4lZGM1hVfRENxLsbXAfhI9BxaLst2OxgQ1JlmJBntt/dmzAgVS3ui24YgJ0TlI32rAzL16LIHZJYI+bbUCQ/yDmAvYyxqW/F8CLHLQ06GrtIui6LQJdkzeOUfJqzSavNQqgm8B+fcFvReACz/vTOPTTRLCrqysDvsYxyGCt0uo5uBGnDVLYROwdH3d6LQeZTtir79wGSLf3IJ5Ad9gvN/vl4znH3XLck01wSbUMU22gbQFTx12glJuAphr4YSz8TQ5Z0wiEhQfikSDPZmEQJ1EKiwwDh/lhsOCJiFYggRYxCFqOlmgCiBfMInw3Jtn7JKKQ+fDKBxGEC+I13Naber6XbL4QMLWG0+i0FGAavUOAafcAMJ1OpacBc+l6AYu8+D4mTMSS5YlkOex+BruJXLl90AOBO/Vi2MEi9elNejAg7QHWb74VibkH6qWPJKyxGWwSLgn/IkCRSRSywF3Bdt9c9wev2cXoejw867PhcMhGowFzQe0gik8ybfPNQf1c4SoT5v3Avrwc8kat2ao34LPbpQAjBhtwgRZnwo/cjQFmvdNhk3PWgN31CRiFzzWkW60CpDPglqF3DBty0whfgsgeOZ0W2Ivs6k69TUaz1aB/upV6VwMXjAPQSHxir8N47SUuCi17FYXpGtm1C8IrMikrz/e92dJdE7XXxrmoSlJUk6XgsSIEn9NG+dTaTh64rW3gvlNmB+0a3IyF2qSFaMbRlK3dhQCD2anU25eIqnqXDCPYSAdIQLaz3qoolIFArQAQ8D0nQ7aUcZDAMIAbL4DtQEUhKgzZGIMk0zMY7CMBvL8AEjpAQ41XEDW464MIUlARj0sPJBcXuk6nvhcvYeVopb3V2vdQWayBRh9JG/gbuFWrBi5A+0Ra1w198ZbXG0r2gZfxDG6R+sLWIimCOFsHOAT7FcuLZqvjdJu1Ug2jFEv9kGI57qJiaVZqWrHcgAAI3/lc8GrGfm2x2o09wq/yhL5nl/oRu210s1frHXdbaF+ugBhLy/Tife5JDdRbtR44YPDpBP8cgb+JpLm3jXOzaJybHTLODdAYvNbi9SZ6xb16zji/Q7csYReRELRV5Lm0yuDcTpbhYxSGKzDQ9SY4kXXwlMA77jSdTlt6x9mdQEq0b0xAJjoAYeAlKHKmngMShKiDpzxBneKmOW6aTxKOW+a4ZVSimmaZha7zertooWu7LbQxCm58z8AUAbDbIHlgCEEG69XJxW8BZR6Q+0Guey43siGJI1nkKch2NdLminQEbAytGbwGILkRYDGSCJ1ZTnEMRIUFvOhWaqBJPCD5zKUP3ACB69KyXgB9CXZAO+k2AGqBePDl1J+jpwxG9c6L0P7ROhHT0yiEMKQCbj7clq99F4CHsF0JN4hRsaCr8Am+4QUPwO2VoI0BaIAAQZhomoDKUMB0p744gdt684VwrG2DEy98HzZ358HeZ7h4QCSwbuUlSFzSdxw0OyglVPXsUa86Ej+nXoT+/bd3sZ8mPjsw9zT/Wt6o1yWDC6pvAob8oyfY68dN+VsE3Pf0yKIl7tS28Csj2hZvthC/IA7w/0btc/Bbb/QaXfCwOx3AbxcMtATwN8Yv7J9POO2fw/4lE2j3GRd6+0HcPX4GiFuVjkQxxHLdPSgGWQZvi8cQexIckUYSUIs0yhzS18MBr7NPCtDX/jyDM8BWfLTR3K7U2nvg3DoEZ4ldblC9heITG8BoRMmPDilqnrn+DD1p/NopRm93HoHaRqxEMU9CbtCJoCMcc4V3uLMMU9JI/CIIfbqAFLH0RHzWW43ecRORNXY9cmgGbiB+E+Md0alBGw7h1zh05wxRPA43oK5Kg996/VmeMrq2QKoREvvIaTY64AlDZIUBLpjPThfx5zS6TXjltCp17SZvLfPJkS3cgF9x2g/H/fAup90U4g9NkmqZb9w+xi3GcT5L1KnAIkG4YZk15fW+aDi1VhMQRvKwoL1KwVIZIn4nBMgvRLkoj8kSrlgsdSoM/KvuFwas3Q7QtCfNcQAWq1bpNvc7l41KuwHKAZ58rJ3LSRJBKM5UwIn3oqh8HpI5DEFVAIGlo+2Hj2zjCQArXuaDJx6Rt76ER9zppF+y9DD9BU5hIr7YdX0Ojp7N+oKc7UfT4Ho0Gp6PJ/ztpF+vd+qtNkaf7fpxBkhvsXx0N8V3yeTtSScdQtSl9xEk6S0IlTFpVgBaZZepn3h3Lvjx8KCesWf1HgY8taKHWry7ZeduIpSqAShfUO545+s0ib05hElutCCS2CyYhT66djHxQAR25ACaM7gXGx6ZZfJFmIJCT7j0APkqWzPP/LBqGrscaMdjPidtuARt+IjZgzWykKIOfudzohpodBe/YHixDeRWywA5i211UDtQ6zfR7ctCxNgjWwXglq6l3BPL9uQwtSnl1pIwxxidMmt7LA28JMYEziACYwkXACCWeBu4xuSGX/TID5YhbSAewcbGG2lFYc0YEoPrCsEVWMbEBd4gzgBG6HSe0AuBlg4gGgn4CCVFWTIJMHI3Y+0tk22vsAs/BGvowrsRXIwGQCIxJnPOSIav396+ZmfD/xqeOzKfRNKi/Il3vjv3Vl7ELlIf8M4gBqdHEvphyRGoPlIblP0zGT1cWcXIFn7+onXJX0DMq5TGicy7m7w4aAylRL6C5viXE9syFUJw1AJaUEV/dnRhafPh7RrpJctLkkYv8ZGMHvlyZy3oSKnMD6gs0/jJFZtEfCwoxn9mtv/WWwkeiwDDTdBgUw+Tp+FMxIC2MYi8NLnC+MfXl1mqJwLaMm8FLqZHYK+Qin8OCa+1dH7QChPpKhf30q4SnZTkQV7axaDnEfZA0qZZazQ6zera/YROMxUW8/QrTcqcSVsP7ouIHiMPVEFWlEohrPdzhLQoiEm+mQDyz3dRcGf65agf36MMktWBP1UyBV4F6Woqoi8QtK8Z8w6y6OqJ6YyTfALjjRXuGE0sA528Qt5FwF3xb5GAKpr9KgT8aiFJjnxPCB5P8uHi84iXqwuADflw5iaujU9TpC1NMlvZ5ZMsuY3ZcJnxNpllnUv+qsj9NunW62mCRSlMdDs6Az+F8BadCJWKx6oUkIMrbGOdCgJsi6zlnq8JjD+cg4ZIjNtbcBl20KgkJS09o0qcBlPvUyWMFtVhgBzfVAfKQ4EVTeiiqvxnTE5U/J9n5Bf//mJUObueVKyr48pk6WKiDWSA9hxXLmBvwWJMnsP36gFnIFYkY7ebtfj9DciAF6Zx/hr6SO70yl2J7xEq+OIaHJDo97Dzm/7o8mw8fHf+uxHVfertTr3brX0vl5q7lGj04+9G9Tpe2O7Vjs11txB6wSW92u8k7bSTduY9QKgCohjeMXuDxPkddFeuvb4FvHlS4oqxO/A55+xCTCMqwtW70t4/jfegfEBcQF0hTwv+oBRK8gT/Xwr+aVIwMO79WvOKkgUnYF8CoSt8mqGqBi39Swb79IXOz4FpAJNvJ90r5I0OZEwivVAjL6f9ye2wD/H44HX/7fkYm5hcuAOIxQRUU0oiYXm4ExGga/8OIxkgPYYGAYrLKel6eDGV367E8ts/2H48qp5OnTeO67zTaXcOePziI24urqo78tisJ2cWPYgF5l5A3/KC4tW8V5u69c60tTu2V9H6MCszTCBwicEf1AH9CRuo0oB0PeAzyx0ZhOB6oVq9wagHC8X9CpusBTLM+0SMf2lfb9UzMEKKHQA4rsBhK3pgqqqvuhwhvRdwlt8vMaz1xQNEPC+Bu9yXboA2tBgX2EGKjHOp9AEqBJiFBoRUjSocv6gfV5qX7A3c4zcxuwk9WJIyV7gy8KMekL8z8dL4lFvROD0FlEU7fxvAbxC7MxnBIjbBhw8wBAxAvYCICvCtYT0Qhc4AsLISxWbo0kaea6JhCg0oqcFj75OQ4q9EX6hgj8GXU6U/2IikYRigmwyr/gnCwnLScyI9ewyje7pfjm5x7C0CYhBwcBHIKHq1MfGv5Fdu6QDFReSuKmz4j7//7xxCBj8lAAaoqjBrF7K5F4Pdj4ECVlsfGnUgpyO/wd05xuXYmCiThXd3epdy69Ze82o5p64/B1U5IzL+CTTC6dvBmyvSCOMNqIPTdHYfFNVBP47DGYZmtgqI4PLKVF5ehv92r8vb7XbziSvF2/Gpefo+8NuX8rrbaLq9RqdLjZkzl41diF2fg/ovALm8fifWibsG7p8H7ZXA6AFNDGJ5F4hZIlAsMyTvTqzpXA2udnsrGSri3YhG+82m6QbDhyhEjyWHZVv0uRT9XDOVFPKQUuGYjwN/uxzThFulxcbp1DPWirb75I3sx/ddCHjdiWhkib2fovq2sZvb0GcC95+dAEMF0b8d9a9uhwN+078dDwdv+Pv+q+sx5S4SiG7v2Xt3ESJI+4mPbQYzYzghsE/QdWFVZj7T/ZRH6kP230U7a2uV9SPe+wdXfVvyyNIqrUaXd+rtukXG7WurVF6popCYktIOtwDiYlkPO8HK9HpN9QeprU90hn/LLYDAlZs2mH2qQvUcSiAjs3QjIQa3Mv4r2H8wN1EI5kP5mEWd4YOG81lhL/oeXN9jrShNEh+rbWkk4mNJ57ize1kks/WGwpMl1qPwUZDKgeBkkgBQ05lSTbdn7NQN7kGlBnfY+jiTVfh4vyuAYLbWbptXlXGmm2P9XObVjQsgG76bdb4KE9Ik2vHZoT60nw7E5jliG0IZx2B720o76D1R+RqUh7VyU1RD1bFSHozsT8s7EHB/2WxSql1yfalOXkwKPtCzNcwBaCDYX10Pri8vz8eDYX/ET8f9M/7m7eTN8IpA6c7ZmxTzWvDXq3CAPI3IqsgmSey8CFdrWdO5QFHCTZkgFLSAxDUrdSCmcPvKPd0e/Ae6jR0+NBu8e9zrWbtZhDOzAtrLoSABHnCvl28x7pULQV8QaxWw7Rz0M5mEv0aC9oXqQMmPwvcB8G97BZasx5j/kfSiKCAS0mc33UtF5G+vn0/p2MPadxOQoxX2XmC/E5hJkcWMMQCBmqFIF0SFHdjIz/FXZgX9jfQa4gN7UfVn2s5O8GvHWKODvICcRyxxmFtg3h854PcrumQUIT0ie9HRNdfEKW5G0mabBRrzBTwfCgIQ1E/b3BaerVxlKZ63EYAQHo7P+/zH68n5zWt+Mzy/Hfcvzid9+NqPYSzWS3bjCQjU7kTssuEwL/BjAcw+p9Qr688fvDgEZstMhcGpfiHtaLPe5l0wwq2uWRksLCMpUNEXdENX3U+Beh9S/0IL5WuzUO55vN3p1GouZY93g/eUvNCxFfiGgW2gsddZG/IT9qINnKzXLg8gV7q2Ue6mjm0csIHa0u76tluSVQQx9mJk7dHSYrA58oAC3znlvBB1DyLy3TXVkDM7k2FVZfSN9z0XMUTVU2yzlovnKqJYY4INszhGD+x0WHfhFp6Bz2XiI2apFwKFf73cUIwDHqpqUUFzxfGwhQnvy+GaWx253owSaDnSqthY1asNdcEFXgiyyNgQsMIOPNjxHqNcAk7KlkD8Qq/pFIiHnnw+xieaIowVj5+N02IlJ0MtR3xwCRBFhriqHrkNg+pjp/NzbeZPVeD++hwCdgrb6TWBE6P2QbgUAcXs8C+z9DjiOwFeDYNZhYS+LJeHt5jhN3+g/+ZVjDbHrWPeabdb1iZLLq6SHQ82lWWy8g9aZwzj6Sa85brdaaOs3VzjfKdzrkz2SB9BKqqCCdZPJ4DA2RNMtiVIRbdZmT3lPTuYoxHofsr7SguYHYOy11Duwxc3Wv0xXSNw8EKZ+1l6a2lZpVpQuSHxcR3G1Atppe0k1Y3oEovRMdw23PsWeqKWpu2cMqM7NcOeeF93ZlOC0DMUsnCOCwuSMNocNOsqoC8wxDG74Pld0IO2UoCUZvKQXGjV4y/OA9h5ja383bP99INQQvifXb8/AzP/+orjKzLvy4C9r7Cz8HGOZ8xUTZL+JL88wMPOyjOHZX2v4/Mto44Ib3abvC0r1jZsQQPP4YYzfT9a21/gyRzffgrQzcW8U+u0Wi13d5K+gHJ2Jh6EH66RjycIYr/E1ptMno3t05JYvADoeXZvB8Rj5qcxen8lqXQlU1niJxLWl4vwLmxNe+kmKCJns11pXGIzW3i3ta78o6wHWTJclrNXYqy6pwvrz7nEEuWDMIL/Tu43qh3FvvsBF17eQOsjgJOTJ4lVk+CZNz3DowDUIVUOebWBHF/KiFO+wyydIdN9scn37Ug25Nz4svDdytDvCd8lLb5GKvApSNN9FadjrOaNweeXTgBW8kbAN3Ag0MaVNh+oop4srMKLLAyItxRCr90Ck9/mzXa9+W2OP15gPmnkpqCY5qChs4S96aXdjsutZF3h6Og+o57lT4lNWTbokLeeKYWSPP3O7o/SLLxqWVHXmVQ8iWjZGc2DNvf60tGHs2U3CTLARbYqwLk+oLLYTwLxB5pc6VWIaVKVJWUP83e6EbUMmsWNWrWzojW10KYAfcglh8gcq/viUTa1y02Z7cQQUQaLZLl/MyE229qcLprrXZ78U4D5pRKPoL26Ht++vuyP/8AHr8dDWYy/HZ9fno76P6Hjvow8WY+/BRmY+tS3Ti4iPPxnXOfOUvwsUd/4IdDXK7+9UavzXr3HO/XWcWFLuUuraxGuIfyY6UXwxCxCgnWw9GbuIsTcQS5pbgLrgTo/f0JQ5fQhamTALIkVdaSUgpR81MLhfCu0NgfzSx1Z2WWte9g0Su227NLj7PDAgpU+iDfquATN7IvEyKharQ04dYQaIi5YEDbD6vyeNWyBrYEwIMUW1N6ORy9NtzT2/AcqrLAwaCiRV2KKVpjJxqNeoLEoqYjrLZYJMlpk+HX2AfgZyLXnI+jWNnNuS5EA7FqExzc/D4VPFVkykcOz0fXgNb8dXoKzfHX9rn8lW5TBOQ5C0O5oIz2IHmCTlpnR5SuyoIG7wD1qc0lt2bkqF3ZReasfVvI+CnOteot3e23ePm7ZqWvrourUC+Oq6/ucXsAtwL6rRekjJv6jm94LNIrv0asfEFlZH2C0iRFkoAjAguAZyHNwaJLNCfvxnXk5CPmrG7SQ08RatAJFhel9b+2Qsk6xEAQh+URXPdFh8xTTU+BYoWFzTNVKs1jLOflM6sCBdI7HypwSGt+RBF2gkwbxisPUxuQbeKBAb0vQXsD/S0GBg0BjflIeK4Arf3xXpT1mAhZXSuyOu16DQ0cHKdCqxhpgqofaJNusBqrDkvg0RqIMnvavzieDaz4Yn/Pb8/4l9VwFIp6F7O2kX0zS6CTsrXBX+SsprXPg2nsGT1F/W6eJ9KKn8m5p7Mp14xgFEce70lJS1YZRXM3dTUZoYQoui66swVOzKqlOzGC7HBuFLsRmp3TA8wQVnaAuOeJ3mVSaXmBKVOZSGDbV3JjOsMpWyq21UA2CmiWUf0VH5/wQj5pb6TzTjeMjGXBdRtzn6kyqXYeR+KBjtODYpdmqsRcg8FapfIRjTuA5dObPoe7dNNJTNuT5oD3DIErl7fNZR5WB29fDqzf8rH81PB+Nzvnl+ega3Y0zDDAgimKXEGqhq+HRhexCm7K80KkKmDHasWzLz9E/U1NvA7RcyI7ryFsgdkl7zlf4rB/A4wWrd+dhMykOa+o2eKPXhGCjVewUtK/MNk7c3LV9+nBbaIeKKlJeqV2W04kRPIJG79lLP9neWFFaC5K3l1IoeEXyWvKuwtB8oS2MrKEOobVSJczpGm1vt/0dCW/o4zlrjObJQjuszVWtnGNYAf7GhswbokG6D+4KjKmuQsmb6cOtTzXHn80dlEvwfP/I+6PzAT/tj8cokX1fzADpEU3OAh/4k+66gD/PP4pZSojfslkOe1uZVIygmQwvdgdopuakEFzH2fQHcBY+KROmfWWw220IeGu9zlYGLH9x1aiGqmoj4I948il6ENUY5QJ8H6B0wNN4+/RofmmZghxY/iFq1Lmd+NojiM8iDdbrbdJaUjixFi6/t1ZHiR9j2ZIA3pZ1RtEeHbad+rHTLIZaYKNvrSZPa3JA0V7LDJjUrMsQe53xC89UnF/IudzBvvKe6lwP/oGGaBWafJiqqA2oJ3ZOAvpX7Akr3/W+HtDilu8gQPr32nPuANN21u1ZPP0aOYTt02g7Rx3uyQo8a9lPDrr+jMctUb2//BO8lPMmnn8SVo4wVWqz0dpxVP7I2FE2kcMXYjqFr/oMsyMWVdao1X5HKVqqqMGHSoP8Ikdlr8Qjzi2CSJuOfs+W5ILKp57QuU0H1WCUMNP1Jj6uPT3txdZ3zz0P+8Z9cOM0iVyGr9CwKqLS4NhyomKjOq7hVLmxliWt4lxEncb5JUl4m/XBGTdocmFRUWYa8JhcuPJm8ZdR7SaN0Mydwe6BAW/ciDrWDtHNS9D1ARqdz9NZ0QcBEfzXkD+TWrPlTzVuEQm/kuTlhw8fALK8DIhEwqfATLSR0kYI/lcG8GcTcLfmLp8mKwmJI2lLCanzr1a3tRJAxfeqjnEz+n0WJZ87TnS0Z66sLH+o44/ZWNmMwrLlyCas6TWysq7b5M4b7gNDPuWQ0PzMUDUrVNI2K0lZZDX1iWrJ/Eza9+O3HPWYPzqt55YcmPbplCxV9q/Bft+UTPUs4QBZKi/O0/sJo62IlM1Gp21RWU2aKqGyLhrImcWGnN92/NBthEEOx/2rQrLOsKvpLSUTozSF5q6sQ0mgFyQSHCKAMvhKcfxhAsoEZJY8o8nwFb/p/5EPLq45xjC1Yyq2PkfbUt2rGAKZseo5BaFGiug8Q2wGrM7p/cJ8kZMs22uqhexOiDlWdcxo9JDOswucFkeDbmjiozcnKflnDB8vDE4h4dRUvh4M+OD66mI0HNx+DSpfATFiJhGuzb5FcN2iabBpTaqXg4XCnTPqY3eTG1CP83g94pmLpHX5z6lUYzFJk0PjQvSYejYNoyjEmUVzJXSVbze/xMxdMYOqDM0nt/2rs/74jF9dD23C55Tz51DW6D5d77MmR7wpnU08TZPCZOJ98yTKJxVX5II2qtyeFaO3/ADti1Z+seETyAkcqrrFg6ub00t+Mx4Ozvm7/qB/NfipVPJ3T4Up5Q/NvlQsUTN3j/q7hqzcReGKiV2TWlRL/rx8sC215As8S7sIE0+OsDRj7gzFebquzjBzSMPeseKknw2BKvDCDxcbRq6R5IWEixpuaX7c4ZeeaUNzYqrvJMCZNAuGbzTx5Ql82zmM5iDfWlt8a5XwLSwdEbOXaQYnqpFOndVSU/aBS/IOsYTMI0IgWFAAlYTKqRO/0MjOg2yYAOVv3/bHP/Hb86v+1S0fDydvSjmx250/yAmp1LBaC2TRsr1ekxd3h93GWDGXDZyow0jZzeVMNqPX9GmfpRsXf+eg8MMGumFGn8VVUUHu5xAUjq4OGhUzLfOb/g4BsknlAQb2Mg2bxv3hZHj1imPVDX3FbW+0lAlyFqE9fLE48lNOPWjLKopdM3GYMINCae4tDrY1Iz+3p33mLIqZ9vlcEn6dkZokaQMlaTJxR1XTDzeyEiV9U91B8a4/envOL95enXHZYbzd8qAbCvLFfexPfgfR0egG/iPL9bJBgYiqmhOkn//ozXPH8HmM1TMw8llJwI5VqVhAHUHY7EKjwwvW/Q7XQP3cJ/v6ArKbgns+wy5z+G6VaV+d/oCwZAa70oWXqtwl78+BYXU1zlP+wISOF3WIczTR3QlmP0flb9rJJFy5Ohc0HI/BHf+Og6dyIk2WxqCqJee9orUI1I8pHRrqY/cw5Fpx9CdcnltDMnLP8ywe4xlDmWHXB5WpMcp0g2BwADqI+O0g72UjB7bjYQRRYa9EQJVKHHqViMVG+rrJZu1hG626GgKT2T0V5l/U8exPW84KVHSRGB1UsJbl4iwzc6xXPl+dfpZmnopVeNJAxpOI4QVqWNkpUMl1Cw3G52fDWyXse0U917ciz9Xk+nFwzrnVuUKQAxRAHDI4t8Pb0CrOrb21wIaEL0RCOQrosBQdzt3VnmkF9bINNy/2OVDk4HJrjnhgdjiTyG4tN4j6M8Agy4WMBjyrJve1irMBF4iPE8Vjg4yf09CkbHXFVcSyv/jLYSGNpcIF5YsNrekkm+ID2GAMAuZG2mKHrcSnT26AbTBUBXdYv3pK3X3xdtsT7VAKi5rtmjm91Nk6FTj6uSt/kMQ0qKgfIuJ4sa8LqA4G7bEjO2H0lFbZlFLMmumGpcnFCKGAnUXbLUw7Ox/sxiTTb3GhC66qTal4g1wmSzVCiI/Y1x/7m4yc+b4dEhxTPLbOapO6Vi4knT2nTh6lstl5sMQPVtQ+u3sC8wAjiumGz2hGeuFP67o/oKSZ34442h7i/ASJ+4K+LNMhpvEeH2p2ou6RJzU8XT6pq8nJd5Hs7HGy+pAyySpvBtohTrKwmO8vKpGk4f7WmRNFkUynqv5+PMCOasRozqcKWL6RKKf72k8WqXqj5jTatHfS8NjLgaYRlPbPX0HEvqyR6mhXm9I3bEDSKo/O1cyBVbEc+pWXSvK69+szajKiEXzn/cmtErxd/T/bDTCIF1t/FbqKqtKq4xKkzS+7ycl270zWD5MTuHFBNmVaXnZkW60ydmdNiUtgtxGRsNqdOdWCKJcYbuXRbpfr9stws/MVleKXtlwVx8pSC1NZ55ISH5tEFnPwQ5ID20czfVc4/x8LLGCl6BAYeioRSyyKMlLB9s2zbuWTsvamzMFVmjsz+lvVBPh486E/kzVRDNf6R1m7EvgDKnP/zDT3gR4mw7hjktfsXESWEsZTSVtzqZ3Sebc0DE9mXezRwWCn+peFubfovtA5JdkhIaNhLn8lyjq5hJUPXcTAn5/xOXzGlcKaC3eO1k+fxqA8Kc1DMBlszKxX5CBn9rgUdKJIJbEwTZUNQnAjYLt1fMqd4ZhzaUy9OVukIGmUxaJhWk/nzOd08+SYosYLI0+y9MnzDqvENIPeyQNFHXyh+h84umqoGjIjePCikA6SEN7kuRaVnjZ1M/kbJSYbgpSTuSuTnModH1G4NOkqmioxD1cUS+HNEXy5qG6KHfAlWa0YduVGXgiAU7+fEmECBifKyQdSeZGkbREopeqHwSHOHegLK8VJLl+PMJGYuAPdaBVny8637Tjap5iHzcUZBooH+yyOGK14dT2sYuEDxd0gQXLT5LRUGiyf26LfSqxIK4N4NSBRKQDzk0+4EOO7Fwsl5J/J43peQD9lAyZslVFcTYy6TnGSDJU6nt96aDjQk8de98wf1WPGdh5fdJ44zjA/s3Okjlir2Ytb4wiyTO9ThzHCTf/9ZyLuZLL0EfYN/8vxVJ2Qy02dtOakbQ9+2xrAV3YelKgBBN0inKxHFCfE6acUJ8VZIzuK8+YkXTUrf+3z6Q5we/f8txyvz9TQgWfPC2N5VqrBUQ7Tg1bw+8VjoAa6W4g1ExRUQmZ7dltu1MFazR0zzP4VzSk7wNed48g0W6kkQ0PgVffMNN3wafgxB+fiSCg69PqEA91ZTs7MjaIBW2rWVNlgLc2iX8NsqoOYOzDrKccj7bxYeyid9WMm8ewe97NjMI76tTsZ7JcN+9g15McMJyrB17/9wCDKxu5m4tYgoBzTznJDWrSU7J7Vko1lKR/bkndszoRY7xulo2K0/DSdIsGtUTOafb/e4S+7HdvnxBHa44G4yI3I9OQiCltzWgft1bgO+1fy8j5RmUoteJ2qulAYgYKwMaG+Gt4vdaBuRjCs/bUOD9GMLYwF2ILrdhnR4LVu4hOWPIacElYWDTKzXKjV6chFR2D50juuP1ehlPkLDOk96uc5eMzewXkCeBeq2+tMXM66Ws5jRMVCrqvApBdlgL+n+K5+39vuv+qbkc+lhSyVHcvqEXIA5VaFK17DRslAUhpSCXKRWxN5zrzIrPLCRI5h4yzg8D3MSoAYycw2uctZsnbrJykyq+3KH38FqW9fUkabkoBxLlBX1cY0sBTWdv69mHy3JnxlyXNr1autNLpd0vE9oNmcZCLf73JHEZ784RpgmToqBCRQuf3MaB0gcElNsZS6qr71m9homXzpcfvXOXAfujhjFbZQF64E1sAqZQWNHUXG8tKYtb7Axd+5D83Z4uIwAOoiKpIXxWR33Syjofzt16oeeWfZjOc0b+72E+p0tCpOtq293VVpZaxJtHe1M1Kpx2qsq9BPcWStgcqW0u+Ymt+Tkz+TavoNYzPtB5SCShXaWLJiIUr8JuHc3VSyoUJ0pFhSi7oMneyHntFRiPBnUoUbBRx/dxn2sqKKAS8MqkE98ee//e3/AF/yvrFOjgAA", "base64")).toString("utf8"));
const out = path.join(__dirname, "..", "Pegasus-Intelligence-2026-07-27.xlsx");
const reportPath = path.join(__dirname, "..", "Pegasus-Intelligence-2026-07-27-validation.json");

function fail(m) { throw new Error(m); }
function value(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(x => x.text).join("");
    if (v.text !== undefined) return v.text;
    if (v.result !== undefined) return v.result;
  }
  return v;
}
function nonEmpty(v) { return v !== null && v !== undefined && String(value(v)).trim() !== ""; }

(async () => {
  if (pkg.version !== "4.4.0") fail(`ExcelJS ${pkg.version} loaded; expected 4.4.0`);

  const templateBuffer = await buildTemplate(ExcelJS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);

  const expectedSheets = ["README", ...Object.keys(core.SHEETS)];
  const actualSheets = wb.worksheets.map(ws => ws.name);
  if (JSON.stringify(actualSheets) !== JSON.stringify(expectedSheets)) {
    fail(`Native template sheet mismatch: ${JSON.stringify(actualSheets)}`);
  }

  for (const [sheetName, rows] of Object.entries(payload.datasets)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) fail(`Missing target sheet ${sheetName}`);
    for (const row of rows) ws.addRow(row);
  }

  wb.creator = "Pegasus Capital Intelligence";
  wb.modified = new Date(payload.as_of + "T12:00:00Z");
  const finalBuffer = Buffer.from(await wb.xlsx.writeBuffer());
  fs.writeFileSync(out, finalBuffer);

  const check = new ExcelJS.Workbook();
  await check.xlsx.load(finalBuffer);
  if (JSON.stringify(check.worksheets.map(ws => ws.name)) !== JSON.stringify(expectedSheets)) {
    fail("ExcelJS round-trip changed sheet order");
  }

  let formulaCells = 0;
  for (const ws of check.worksheets) {
    ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      const v = cell.value;
      if (cell.formula || (v && typeof v === "object" && (v.formula !== undefined || v.sharedFormula !== undefined))) formulaCells++;
    }));
  }
  if (formulaCells) fail(`Found ${formulaCells} formula cells`);

  const parsed = await preview._parseWorkbook(finalBuffer);
  const expectedContract = Object.keys(core.SHEETS);
  if (JSON.stringify(parsed.found) !== JSON.stringify(expectedContract)) {
    fail(`Production parser recognized ${JSON.stringify(parsed.found)}, expected ${JSON.stringify(expectedContract)}`);
  }

  const parserRowCounts = {};
  const rowErrors = [];
  for (const name of expectedContract) {
    const rows = parsed.bySheet[name] || [];
    parserRowCounts[name] = rows.length;
    const expected = payload.datasets[name].length;
    if (rows.length !== expected) fail(`${name} parser rows ${rows.length}, expected ${expected}`);
    for (const r of rows) {
      if (r.errors && r.errors.length) rowErrors.push({ sheet: name, row: r.rowNumber || r.row_number, errors: r.errors });
    }
  }
  if (rowErrors.length) fail(`Normalized row errors: ${JSON.stringify(rowErrors)}`);

  let seq = 0;
  const plan = core.planActions(parsed.bySheet, {}, {
    adminId: "00000000-0000-0000-0000-000000000001",
    today: payload.as_of,
    genId: () => "00000000-0000-0000-0000-" + String(++seq).padStart(12, "0"),
  });
  if (plan.summary.invalid !== 0) fail(`Planner invalid rows: ${plan.summary.invalid}; ${JSON.stringify(plan.errors)}`);
  if (plan.summary.conflict !== 0) fail(`Planner conflicts: ${plan.summary.conflict}`);

  const loansWs = check.getWorksheet("Loans");
  let loanDataRows = 0;
  loansWs.eachRow({ includeEmpty: false }, (row, n) => {
    if (n > 1 && row.values.slice(1).some(nonEmpty)) loanDataRows++;
  });
  if (loanDataRows !== 0) fail(`Loans must be header-only; found ${loanDataRows} rows`);

  for (const name of expectedContract) {
    const ws = check.getWorksheet(name);
    const expected = core.SHEETS[name].columns.map(c => c[0]);
    const got = expected.map((_, i) => String(value(ws.getRow(1).getCell(i + 1).value) || ""));
    if (JSON.stringify(got) !== JSON.stringify(expected)) fail(`${name} header mismatch`);
  }

  const sha256 = crypto.createHash("sha256").update(finalBuffer).digest("hex");
  const report = {
    status: "PASS",
    validator: `ExcelJS ${pkg.version}`,
    productionParser: "netlify/functions/intelligence-import-preview.js::_parseWorkbook",
    productionPlanner: "netlify/functions/lib/intelligence-import-core.js::planActions",
    filename: path.basename(out),
    bytes: finalBuffer.length,
    sha256,
    sheets: actualSheets,
    parserRecognizedSheets: parsed.found,
    parserRowCounts,
    expectedDataRowCounts: Object.fromEntries(Object.entries(payload.datasets).map(([k,v]) => [k,v.length])),
    formulaCells,
    loanDataRows,
    plannerSummary: plan.summary,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => {
  console.error("VALIDATION FAILED:", e.stack || e.message);
  process.exit(1);
});
