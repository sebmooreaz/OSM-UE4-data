import expat from 'node-expat'
import fs from 'fs'
import events from 'events'
import zlib from 'zlib'

const expectedFileBegining = `<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="Osmosis 0.46">`

class BigXmlReader extends events.EventEmitter {

  private stream: any
  private streamFinished: boolean = false

  private bytesStart: number
  private bytesEnd: number
  private gzipbigXml: boolean
  private parser: expat

  constructor(private filename: string, private recordRegEx, options?) {
    super()

    options = options || {}
    options.gzip = options.gzip || false

    this.bytesStart = options.start || 0
    this.bytesEnd = options.end || Infinity
    this.gzipbigXml = Boolean(options.gzipbigXml)
    this.parser = new expat('UTF-8')

    let firstChunk = true

    const onData = (data) => {
      if (this.bytesStart > 0 && firstChunk) {
        this.emit('debug', `firstChunk, will fix the begining`)
        // this.emit('debug', `before: ${data}`)
        data = Buffer.concat([
          Buffer.from(expectedFileBegining),
          data
        ])
        // this.emit('debug', `after: ${data}`)
        firstChunk = false
      }
      if (!this.parser.parse(data)) {
        this.emit('error', new Error('XML Error: ' + this.parser.getError()))
      } else {
        this.emit('data', data)
      }
    }
    const onError = (err) => {
      this.emit('error', new Error(err))
    }

    setTimeout(() => {
      this.initStream(onData, onError, this.bytesStart, this.bytesEnd)
      this.start()
    }, 0)
  }

  initStream(onData, onError, start = 0, end = Infinity) {
    this.emit('debug', `initStream - ${start}, ${end}`)
    this.stream = fs.createReadStream(this.filename, {
      start, end //, highWaterMark: 0.5 * 1024
    })

    if (this.gzipbigXml) {
      const gunzip = zlib.createGunzip()
      this.stream.pipe(gunzip)
      this.stream = gunzip
    }

    this.stream.on('data', onData)
    this.stream.on('error', onError)
    this.stream.on('end', () => this.streamFinished = true)
  }

  start() {

    var node: XmlNode = {}
    var nodes = []
    var record
    var isCapturing = false
    var level = 0

    // this.parser.on('processingInstruction', (target, data) => {
    //   this.emit('debug', 'processingInstruction: ' + target + data)
    // })
    // this.parser.on('xmlDecl', (version, encoding, standalone) => {
    //   this.emit('debug', 'xmlDecl: ' + version + encoding + standalone)
    // })
    // this.parser.on('startCdata', () => {
    //   this.emit('debug', 'startCdata')
    // })
    // this.parser.on('endCdata', () => {
    //   this.emit('debug', 'endCdata')
    // })
    // this.parser.on('entityDecl', (entityName, isParameterEntity, value, base, systemId, publicId, notationName) => {
    //   this.emit('debug', 'entityDecl: ' + entityName + isParameterEntity + value + base + systemId + publicId + notationName)
    // })

    this.parser.on('startElement', (name, attrs) => {
      level++

      if (!isCapturing && !name.match(this.recordRegEx)) {
        return
      }
      else if (!isCapturing) {
        isCapturing = true
        node = {}
        nodes = []
        record = undefined
      }

      if (node.children === undefined) {
        node.children = []
      }

      var child: XmlNode = { tag: name }
      node.children.push(child)

      if (Object.keys(attrs).length > 0) {
        child.attrs = attrs
      }

      nodes.push(node)
      node = child

      if (name.match(this.recordRegEx)) {
        record = node
      }
    })

    this.parser.on('text', (txt) => {
      if (!isCapturing) {
        return
      }

      if (txt.length > 0) {
        if (node.text === undefined) {
          node.text = txt
        } else {
          node.text += txt
        }
      }
    })

    this.parser.on('endElement', (name) => {
      level--
      node = nodes.pop()

      if (name.match(this.recordRegEx)) {
        isCapturing = false
        this.emit('record', record)
      }

      if (level === 0) {
        this.emit('end')
      }

    })
  }

  pause() {
    this.stream.pause()
  }

  resume() {
    this.stream.resume()
  }

  static createReader = (filename, recordRegEx, options?) => {
    return new BigXmlReader(filename, recordRegEx, options)
  }
}

export default BigXmlReader

type XmlNode = {
  tag?: string,
  children?: Array<XmlNode>,
  text?: string,
  attrs?: Array<string>
}
