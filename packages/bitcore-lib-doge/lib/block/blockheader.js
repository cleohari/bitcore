'use strict';

var _ = require('lodash');
var BN = require('../crypto/bn');
var BufferUtil = require('../util/buffer');
var BufferReader = require('../encoding/bufferreader');
var BufferWriter = require('../encoding/bufferwriter');
var Hash = require('../crypto/hash');
var $ = require('../util/preconditions');
var Script = require('../script');

var GENESIS_BITS = 0x1e0ffff0; // Regtest: 0x207fffff

/**
 * Instantiate a BlockHeader from a Buffer, JSON object, or Object with
 * the properties of the BlockHeader
 *
 * @param {*} - A Buffer, JSON string, or Object
 * @returns {BlockHeader} - An instance of block header
 * @constructor
 */
var BlockHeader = function BlockHeader(arg) {
  if (!(this instanceof BlockHeader)) {
    return new BlockHeader(arg);
  }
  var info = BlockHeader._from(arg);
  this.version = info.version;
  this.prevHash = info.prevHash;
  this.merkleRoot = info.merkleRoot;
  this.time = info.time;
  this.timestamp = info.time;
  this.bits = info.bits;
  this.nonce = info.nonce;
  this._auxpow = info.auxpow;

  if (info.hash) {
    $.checkState(
      this.hash === info.hash,
      'Argument object hash property does not match block hash.'
    );
  }

  return this;
};

/**
 * @param {*} - A Buffer, JSON string or Object
 * @returns {Object} - An object representing block header data
 * @throws {TypeError} - If the argument was not recognized
 * @private
 */
BlockHeader._from = function _from(arg) {
  var info = {};
  if (BufferUtil.isBuffer(arg)) {
    info = BlockHeader._fromBufferReader(BufferReader(arg));
  } else if (_.isObject(arg)) {
    info = BlockHeader._fromObject(arg);
  } else {
    throw new TypeError('Unrecognized argument for BlockHeader');
  }
  return info;
};

/**
 * @param {Object} - A JSON string
 * @returns {Object} - An object representing block header data
 * @private
 */
BlockHeader._fromObject = function _fromObject(data) {
  $.checkArgument(data, 'data is required');
  var prevHash = data.prevHash;
  var merkleRoot = data.merkleRoot;
  if (_.isString(data.prevHash)) {
    prevHash = BufferUtil.reverse(Buffer.from(data.prevHash, 'hex'));
  }
  if (_.isString(data.merkleRoot)) {
    merkleRoot = BufferUtil.reverse(Buffer.from(data.merkleRoot, 'hex'));
  }
  var info = {
    hash: data.hash,
    version: data.version,
    prevHash: prevHash,
    merkleRoot: merkleRoot,
    time: data.time,
    timestamp: data.time,
    bits: data.bits,
    nonce: data.nonce,
    auxpow: data.auxpow
  };
  return info;
};

/**
 * @param {Object} - A plain JavaScript object
 * @returns {BlockHeader} - An instance of block header
 */
BlockHeader.fromObject = function fromObject(obj) {
  var info = BlockHeader._fromObject(obj);
  return new BlockHeader(info);
};

/**
 * @param {Binary} - Raw block binary data or buffer
 * @returns {BlockHeader} - An instance of block header
 */
BlockHeader.fromRawBlock = function fromRawBlock(data) {
  if (!BufferUtil.isBuffer(data)) {
    data = Buffer.from(data, 'binary');
  }
  var br = BufferReader(data);
  br.pos = BlockHeader.Constants.START_OF_HEADER;
  var info = BlockHeader._fromBufferReader(br);
  return new BlockHeader(info);
};

/**
 * @param {Buffer} - A buffer of the block header
 * @returns {BlockHeader} - An instance of block header
 */
BlockHeader.fromBuffer = function fromBuffer(buf) {
  var info = BlockHeader._fromBufferReader(BufferReader(buf));
  return new BlockHeader(info);
};

/**
 * @param {string} - A hex encoded buffer of the block header
 * @returns {BlockHeader} - An instance of block header
 */
BlockHeader.fromString = function fromString(str) {
  var buf = Buffer.from(str, 'hex');
  return BlockHeader.fromBuffer(buf);
};

/**
 * @param {BufferReader} - A BufferReader of the block header
 * @returns {Object} - An object representing block header data
 * @private
 */
BlockHeader._fromBufferReader = function _fromBufferReader(br) {
  var info = {};
  info.version = br.readInt32LE();
  info.prevHash = br.read(32);
  info.merkleRoot = br.read(32);
  info.time = br.readUInt32LE();
  info.bits = br.readUInt32LE();
  info.nonce = br.readUInt32LE();
  info.auxpow = new AuxPow(info, br);
  return info;
};

/**
 * @param {BufferReader} - A BufferReader of the block header
 * @returns {BlockHeader} - An instance of block header
 */
BlockHeader.fromBufferReader = function fromBufferReader(br) {
  var info = BlockHeader._fromBufferReader(br);
  return new BlockHeader(info);
};

/**
 * @returns {Object} - A plain object of the BlockHeader
 */
BlockHeader.prototype.toObject = BlockHeader.prototype.toJSON = function toObject() {
  return {
    hash: this.hash,
    version: this.version,
    prevHash: BufferUtil.reverse(this.prevHash).toString('hex'),
    merkleRoot: BufferUtil.reverse(this.merkleRoot).toString('hex'),
    time: this.time,
    bits: this.bits,
    nonce: this.nonce
  };
};

/**
 * @param {Boolean} - Include AuxPow header (default: true)
 * @returns {Buffer} - A Buffer of the BlockHeader
 */
BlockHeader.prototype.toBuffer = function toBuffer(includeAuxPow = true) {
  return this.toBufferWriter(null, includeAuxPow).concat();
};

/**
 * @returns {string} - A hex encoded string of the BlockHeader
 */
BlockHeader.prototype.toString = function toString() {
  return this.toBuffer().toString('hex');
};

/**
 * @param {BufferWriter} - An existing instance BufferWriter
 * @param {Boolean} - Include AuxPow header (default: true)
 * @returns {BufferWriter} - An instance of BufferWriter representation of the BlockHeader
 */
BlockHeader.prototype.toBufferWriter = function toBufferWriter(bw, includeAuxPow = true) {
  if (!bw) {
    bw = new BufferWriter();
  }
  bw.writeInt32LE(this.version);
  bw.write(this.prevHash);
  bw.write(this.merkleRoot);
  bw.writeUInt32LE(this.time);
  bw.writeUInt32LE(this.bits);
  bw.writeUInt32LE(this.nonce);
  if (includeAuxPow && this.isAuxPow()) {
    this.auxpow.toBufferWriter(bw);
  }
  
  return bw;
};

/**
 * Returns the target difficulty for this block
 * @param {Number} bits
 * @returns {BN} An instance of BN with the decoded difficulty bits
 */
BlockHeader.prototype.getTargetDifficulty = function getTargetDifficulty(bits) {
  bits = bits || this.bits;

  var target = new BN(bits & 0xffffff);
  var mov = 8 * ((bits >>> 24) - 3);
  while (mov-- > 0) {
    target = target.mul(new BN(2));
  }
  return target;
};

/**
 * @link https://github.com/dogecoin/dogecoin/blob/f80bfe9068ac1a0619d48dad0d268894d926941e/src/rpc/blockchain.cpp#L47
 * @return {Number}
 */
BlockHeader.prototype.getDifficulty = function getDifficulty() {
  // minimum difficulty = 1.0.
  if (!this.bits) {
    return 1.0;
  }

  let decimalShift = (this.bits >> 24) & 0xff;

  let difficulty = 0x0000ffff / (this.bits & 0x00ffffff);

  while (decimalShift < 29) {
    difficulty *= 256.0;
    decimalShift++;
  }
  while (decimalShift > 29) {
    difficulty /= 256.0;
    decimalShift--;
  }

  return parseFloat(difficulty.toFixed(19));
};

/**
 * @returns {Buffer} - The little endian hash buffer of the header
 */
BlockHeader.prototype._getHash = function hash() {
  var buf = this.toBuffer(false);
  return Hash.sha256sha256(buf);
};

var idProperty = {
  configurable: false,
  enumerable: true,
  /**
   * @returns {string} - The big endian hash buffer of the header
   */
  get: function() {
    if (!this._id) {
      this._id = BufferReader(this._getHash()).readReverse().toString('hex');
    }
    return this._id;
  },
  set: _.noop
};
Object.defineProperty(BlockHeader.prototype, 'id', idProperty);
Object.defineProperty(BlockHeader.prototype, 'hash', idProperty);

/**
 * @returns {Boolean} - If timestamp is not too far in the future
 */
BlockHeader.prototype.validTimestamp = function validTimestamp() {
  var currentTime = Math.round(new Date().getTime() / 1000);
  if (this.time > currentTime + BlockHeader.Constants.MAX_TIME_OFFSET) {
    return false;
  }
  return true;
};

/**
 * @returns {Boolean} - If the proof-of-work hash satisfies the target difficulty
 */
BlockHeader.prototype.validProofOfWork = function validProofOfWork() {
  // For Litecoin, we use the scrypt hash to calculate proof of work
  let hashBuf;
  if (this.isAuxPow()) {
    hashBuf = this.auxpow.parentBlock.toBuffer();
  } else {
    hashBuf = this.toBuffer()
  }
  var pow = new BN(Hash.scrypt(hashBuf));
  var target = this.getTargetDifficulty();

  if (pow.cmp(target) > 0) {
    return false;
  }
  return true;
};

/**
 * @returns {string} - A string formatted for the console
 */
BlockHeader.prototype.inspect = function inspect() {
  return '<BlockHeader ' + this.id + '>';
};


/**
 * @returns {Boolean} - Whether block is part of an Aux Proof-of-Work
 */
BlockHeader.prototype.isAuxPow = function() {
  // Reference for AuxPoW bit:
  // https://github.com/dogecoin/dogecoin/blob/0b46a40ed125d7bf4b5a485b91350bc8bdc48fc8/src/primitives/pureheader.h#L131
  return Boolean(this.version & (1 << 8));
}

Object.defineProperty(BlockHeader.prototype, 'auxpow', {
  configurable: false,
  enumerable: true,
  /**
   * @returns {AuxPow}
   */
  get: function() {
    if (this.isAuxPow()) {
      return this._auxpow;
    }
    return null;
  }
})

/**
 * Parse the Aux Proof-of-Work block in the block header
 * Ref: https://en.bitcoin.it/wiki/Merged_mining_specification#Aux_proof-of-work_block
 * @param {BufferReader} br - BufferReader containing the header
 */
BlockHeader.prototype._parseAuxPoW = function(br) {
  // Reference for AuxPoW bit:
  // https://github.com/dogecoin/dogecoin/blob/0b46a40ed125d7bf4b5a485b91350bc8bdc48fc8/src/primitives/pureheader.h#L131
  if (!(this.version & 1 << 8)) {
    return this;
  }

  // Coinbase Txn
  const getTxn = () => {
    const version = br.readInt32LE();
    // If flag is 1, then has witness(es) (see below)
    let flag = 0;
    if (br.buf.readUInt16BE(br.pos) === 1) {
      flag = br.readUInt16BE();
    }
    // Tx_ins
    const getTxIn = () => {
      const prevOutput = {
        hash: br.read(32),
        index: br.read(4)
      };
      const scriptLen = br.readVarintNum();
      const script = br.read(scriptLen);
      const sequence = br.readUInt32LE();
      return {
        prevOutput,
        scriptLen,
        script,
        sequence
      }
    }
    const txInCount = br.readVarintNum();
    const txIn = [];
    for (let i = 0; i < txInCount; i++) {
      txIn.push(getTxIn());
    }
    // Tx_outs
    const getTxOut = () => {
      const value = br.read(8);
      const pkScriptLen = br.readVarintNum();
      const pkScript = br.read(pkScriptLen);
      return {
        value,
        scriptLen: pkScriptLen,
        script: new Script(pkScript)
      }
    }
    const txOutCount = br.readVarintNum();
    const txOut = [];
    for (let i = 0; i < txOutCount; i++) {
      txOut.push(getTxOut());
    }
    // Tx_witnesses
    const txWitnesses = [];
    if (flag) {
      for (let i = 0; i < txInCount; i++) {
        const componentCnt = br.readVarintNum();
        for (let j = 0; j < componentCnt; j++) {
          const componentLen = br.readVarintNum();
          txWitnesses.push(br.read(componentLen));
        }
      }
    }
    // Locktime
    const lockTime = br.readUInt32LE();
    return {
      version,
      flag,
      txInCount,
      txIn,
      txOutCount,
      txOut,
      txWitnesses,
      lockTime
    }
  };
  
  // Could possibly use Transaction().fromBufferReader(br), but it's throwing due to bnNum instanceof BN === false ??
  const coinbaseTxn = getTxn();
  const blockHash = br.read(32);
  
  const merkleBranch = () => {
    const branchLen = br.readVarintNum();
    const branchHashes = [];
    for (let j = 0; j < branchLen; j++) {
      branchHashes.push(br.readReverse(32));
    }
    const branchSideMask = br.readInt32LE();
    return {
      branchLen,
      branchHashes,
      branchSideMask
    }
  };
  
  const coinbaseBranch = merkleBranch();
  const blockchainBranch = merkleBranch();
  let parentBlock = br.read(80);
  parentBlock = new BlockHeader(parentBlock);

  this.auxpow = {
    coinbaseTxn,
    blockHash,
    coinbaseBranch,
    blockchainBranch,
    parentBlock
  }
  
  return this;
}

BlockHeader.Constants = {
  START_OF_HEADER: 0, // Start buffer position in raw block data
  MAX_TIME_OFFSET: 2 * 60 * 60, // The max a timestamp can be in the future
  LARGEST_HASH: new BN('10000000000000000000000000000000000000000000000000000000000000000', 'hex')
};

module.exports = BlockHeader;

var AuxPow = require('./auxpow');
