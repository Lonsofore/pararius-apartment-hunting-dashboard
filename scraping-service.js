'use strict';

const EventEmitter = require("events");

const axios = require("axios");
const cheerio = require("cheerio");
const request = require("request");
const got = require("got");
const throttledQueue = require('throttled-queue');

const config = require("./config");

const throttle = throttledQueue(config.parariusMaxRequestPerSecond, 1000);

const URL_REGEX = /^(https:\/\/)(www.)?(pararius.com\/apartments)(\/(?!page)[a-zA-z0-9\-]+)+(\/page\-\d{0,2})?(\/?)/;
const MAX_RESULT = config.maxScrapingResults;

module.exports = class ScrapingService extends EventEmitter {

  constructor(url, updateFrequency) {
    super();
    this.scrapingWorker = null;
    this.url = url;
    this.updateFrequency = updateFrequency < 15 ? 15 : updateFrequency;
    this.isWorking = false;
    this._sanitizeUrl();
  }

  start() {
    if (this._isUrlValid() && !this.isWorking) {
      let self = this;
      this.stop();
      this._startScraping();
      this.scrapingWorker = setInterval(() => {
        if (!self.isWorking)
          self._startScraping();
      }, this.updateFrequency * 60 * 1000);
    }
  }


  stop() {
    if (this.scrapingWorker) clearInterval(this.scrapingWorker);
    this.isWorking = false;
  }

  _fetchWebsite(pageNumber) {
    let self = this;
    var promise = new Promise(function (resolve, reject) {
      throttle(() => {
        got(self.url + pageNumber).then(function (result) {
            resolve(cheerio.load(result.body));
          })
          .catch(function (error) {
            reject(error);
          })
      });
    });
    return promise;
  }

  _isUrlValid() {
    return URL_REGEX.test(this.url);
  }

  _startScraping() {
    this.isWorking = true;
    let self = this;
    self.emit("start")
    self._fetchWebsite(1).then(($) => {
      self._scrap($);
      let count = parseInt($("span.search-list-header__count").text())
      count = count > MAX_RESULT ? MAX_RESULT : count
      const pages = Math.ceil(count / 30)
      if (pages > 1) {
        let unProcessedPages = pages - 1;
        for (let i = 2; i <= pages; i++) {
          self._fetchWebsite(i).then(($) => {
            unProcessedPages--;
            self._scrap($)
            if (unProcessedPages == 0 && self.isWorking) {
              self.isWorking = false;
              self.emit("end")
            }
          }).catch((error) => {
            unProcessedPages--;
            self.emit('error', error)
            if (unProcessedPages == 0 && self.isWorking) {
              self.isWorking = false;
              self.emit("end")
            }
          });
        }
      } else {
        self.isWorking = false;
        self.emit("end");
      }
    }).catch(error => {
      console.trace()
      self.emit('error', error)
      self.isWorking = false;
      self.emit("end");
    });
  }

  _sanitizeUrl() {
    if (this._isUrlValid()) {
      this.url = this.url.match(URL_REGEX)[0];
      const matchingGroups = this.url.match(URL_REGEX);
      if (matchingGroups[5] && matchingGroups[5].length > 0) {
        this.url = this.url.substring(0, this.url.indexOf("/page-"));
      }
      this.url = this.url + "/page-"
    }
  }

  _scrap($) {
    let self = this;
    $("ul.search-list li.search-list__item--listing").each((index , element) => {
      let url = "https://www.pararius.com" + $(".listing-search-item__title > a", element).attr("href").trim()
      let urlSplit = url.split('/')
      let id = urlSplit[urlSplit.length - 2]
      let price = parseInt($(".listing-search-item__price", element).text().replace(/[€,]+/g, '').trim())
      let name = $(".listing-search-item__title", element).text().replace(/\s\s+/g, ' ').trim()
      let imgSvg = $('.picture--listing-search-item img', element).attr('src');
      let locationInfo = $(".listing-search-item__location", element).clone().children().remove().end().text().trim();
      let locationInfoSplit = locationInfo.split(' ');
      let zipCode = (locationInfoSplit[0] + ' ' + locationInfoSplit[1]).trim()
      let city = locationInfoSplit[2].trim()
      let neighborhood = locationInfo.match(/\((.*)\)/)[1];
      let estateAgentName = $(".listing-search-item__info .listing-search-item__link", element).text().trim()
      let estateAgentLink = $(".listing-search-item__info > a", element).attr("href").trim()
      let surfaceArea = parseInt($('.illustrated-features__list > li:nth-child(1) > div > span.illustrated-features__description', element).text().trim())
      let bedrooms = parseInt($(".illustrated-features__list > li:nth-child(2) > div > span.illustrated-features__description", element).text().trim())
      /*let furniture = $("ul.property-features > li.furniture", element).text().trim()
      let availability = $("ul.property-features > li.date", element).text().trim()
      */
      let locationUrl = `https://www.google.com/maps/place/${locationInfo}`
      self.emit("property", {
        id: id,
        price: price,
        name: name,
        imgSvg: imgSvg,
        url: url,
        zipCode: zipCode,
        city: city,
        neighborhood: neighborhood,
        agentName: estateAgentName,
        agentUrl: estateAgentLink,
        surfaceArea: surfaceArea,
        bedrooms: bedrooms,
        /*furniture: furniture,
        availability: availability,
        */
        discoveryDate: new Date().toLocaleString('it-IT'),
        locationUrl: locationUrl
      })
    });
  }
}