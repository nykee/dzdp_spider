//依赖库
var util = require("util");
var superagent = require("superagent");
var cheerio = require("cheerio");
var async = require("async");
var fs = require('fs');

//声明全局变量，用于存放配置项及中间结果：
var cityOptions = {
    "cityId": 1, // 上海
    // 全部商区, 蜀山区, 庐阳区, 包河区, 政务区, 瑶海区, 高新区, 经开区, 滨湖新区, 其他地区, 肥西县
    // "regionIds": [0, 356, 355, 357, 8840, 354, 8839, 8841, 8843, 358, -922],
    "categoryId": 10, // 美食
    "sortId": 2, // 人气最高
    "threshHold": 5000 // 最多餐馆数
};

var idVisited = {}; // used to distinct shop
var ratingDict = {}; // id -> ratings
var posDict = {}; // id -> pos

//判断一个id是否在前面出现过，若object没有该id，则为undefined（注意不是null）：
function isVisited(id) {
    if (idVisited[id] != undefined) {
        return true;
    } else {
        idVisited[id] = true;
        return false;
    }
}
//采取回调函数的方式，实现顺序逐步地递归调用爬虫函数
function DianpingSpider(regionId, start, callback) {
    console.log('crawling region=', regionId, ', start =', start);
    var searchBase = 'http://m.api.dianping.com/searchshop.json?&regionid=%s&start=%s&categoryid=%s&sortid=%s&cityid=%s';
    var url = util.format(searchBase, regionId, start, cityOptions.categoryId, cityOptions.sortId, cityOptions.cityId);
    superagent.get(url)
        .end(function (err, res) {
            if (err) return console.log(err.stack);
            var restaurants = [];
            var data = JSON.parse(res.text);
            var shops = data['list'];
            shops.forEach(function (shop) {
                var restaurant = {};
                if (!isVisited(shop['id'])) {
                    restaurant.id = shop['id'];
                    restaurant.name = shop['name'];
                    restaurant.branchName = shop['branchName'];
                    var regex = /(.*?)(\d+)(.*)/g;
                    if (shop['priceText'].match(regex)) {
                        restaurant.price = parseInt(regex.exec(shop['priceText'])[2]);
                    } else {
                        restaurant.price = shop['priceText'];
                    }
                    restaurant.star = shop['shopPower'] / 10;
                    restaurant.category = shop['categoryName'];
                    restaurant.region = shop['regionName'];
                    restaurants.push(restaurant);

                }
            });

            var nextStart = data['nextStartIndex'];
            if (nextStart > start && nextStart < cityOptions.threshHold) {
                DianpingSpider(regionId, nextStart, function (err, restaurants2) {
                    if (err) return callback(err);
                    callback(null, restaurants.concat(restaurants2))
                });
            } else {
                callback(null, restaurants);
            }
        });
}
/*在调用爬虫函数时，采用async的mapLimit函数实现对并发的控制（代码参考这里）；
采用async的until对并发的协同处理，
保证三份数据结果的id一致性（不会因为并发完成时间不一致而丢数据）：
*/
DianpingSpider(0, 0, function (err, restaurants) {
    if (err) return console.log(err.stack);
    var concurrency = 0;
    var crawlMove = function (id, callback) {
        var delay = parseInt((Math.random() * 30000000) % 1000, 10);
        concurrency++;
        console.log('current concurrency:', concurrency, ', now crawling id=', id, ', costs(ms):', delay);
        parseShop(id);
        parseMap(id);
        setTimeout(function () {
            concurrency--;
            callback(null, id);
        }, delay);
    };


    async.mapLimit(restaurants, 5, function (restaurant, callback) {
        crawlMove(restaurant.id, callback)
    }, function (err, ids) {
        console.log('crawled ids:', ids);
        var resultArray = [];
        async.until(
            function () {
                return restaurants.length === Object.keys(ratingDict).length && restaurants.length === Object.keys(posDict).length
            },
            function (callback) {
                setTimeout(function () {
                    callback(null)
                }, 1000)
            },
            function (err) {
                restaurants.forEach(function (restaurant) {
                    var rating = ratingDict[restaurant.id];
                    var pos = posDict[restaurant.id];
                    var result = Object.assign(restaurant, rating, pos);
                    resultArray.push(result);
                });
                writeAsJson(resultArray);
            }
        );
    });
});

function parseShop(id) {
    var shopBase = 'http://m.dianping.com/shop/%s';
    var shopUrl = util.format(shopBase, id);
    superagent.get(shopUrl)
        .end(function (err, res) {
            if (err) return console.log(err.stack);
            console.log('crawling shop:', shopUrl);
            var restaurant = {};
            var $ = cheerio.load(res.text);
            var desc = $("div.shopInfoPagelet > div.desc > span");
            restaurant.taste = desc.eq(0).text().split(":")[1];
            restaurant.surrounding = desc.eq(1).text().split(":")[1];
            restaurant.service = desc.eq(2).text().split(":")[1];
            ratingDict[id] = restaurant;
        });
}

function parseMap(id) {
    var mapBase = 'http://m.dianping.com/shop/%s/map';
    var mapUrl = util.format(mapBase, id);
    superagent.get(mapUrl)
        .end(function (err, res) {
            if (err) return console.log(err.stack);
            console.log('crawling map:', mapUrl);
            var restaurant = {};
            var $ = cheerio.load(res.text);
            var data = $("body > script").text();
            var latRegex = /(.*lat:)(\d+.\d+)(.*)/;
            var lngRegex = /(.*lng:)(\d+.\d+)(.*)/;
            if(data.match(latRegex) && data.match(lngRegex)) {
                restaurant.latitude = latRegex.exec(data)[2];
                restaurant.longitude = lngRegex.exec(data)[2];
            }else {
                restaurant.latitude = '';
                restaurant.longitude = '';
            }
            posDict[id] = restaurant;
        });
}

function writeAsJson(arr) {
    fs.writeFile(
        'data.json',
        arr.map(function (data) {
            return JSON.stringify(data);
        }).join('\n'),
        function (err) {
            if (err) return err.stack;
        })
}
/**
 * Created by Administrator on 2016/11/4.
 */
