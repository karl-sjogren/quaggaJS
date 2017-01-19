import BarcodeReader from './barcode_reader';
import {merge} from 'lodash';

function PlesseyReader(opts) {
    opts = merge(getDefaulConfig(), opts);
    BarcodeReader.call(this, opts);
    this.barSpaceRatio = [1, 1];
    if (opts.normalizeBarSpaceWidth) {
        this.SINGLE_CODE_ERROR = 0.38;
        this.AVG_CODE_ERROR = 0.09;
    }
}

function getDefaulConfig() {
    var config = {};

    Object.keys(PlesseyReader.CONFIG_KEYS).forEach(function(key) {
        config[key] = PlesseyReader.CONFIG_KEYS[key].default;
    });
    return config;
}

var N = 1,
    W = 2.7,
    T = 5,
    properties = {
        START_PATTERN: { value: [W, W, N, W] },
        STOP_PATTERN:  { value: [T, N, W, N, N] },
        CODE_PATTERN:  { value: [
            [N, N, N, N], // 0
            [W, N, N, N], // 1
            [N, W, N, N], // 2
            [W, W, N, N], // 3
            [N, N, W, N], // 4
            [W, N, W, N], // 5
            [N, W, W, N], // 6
            [W, W, W, N], // 7
            [N, N, N, W], // 8
            [W, N, N, W], // 9
            [N, W, N, W], // A
            [W, W, N, W], // B
            [N, N, W, W], // C
            [W, N, W, W], // D
            [N, W, W, W], // E
            [W, W, W, W], // F
        ]},
        SINGLE_CODE_ERROR: {value: 0.78, writable: true},
        AVG_CODE_ERROR: {value: 0.38, writable: true},
        MAX_CORRECTION_FACTOR: {value: 5},
        FORMAT: {value: "plessey"}
    };

PlesseyReader.prototype = Object.create(BarcodeReader.prototype, properties);
PlesseyReader.prototype.constructor = PlesseyReader;

PlesseyReader.prototype._matchPattern = function(counter, code) {
    if (this.config.normalizeBarSpaceWidth) {
        var i,
            counterSum = [0, 0],
            codeSum = [0, 0],
            correction = [0, 0],
            correctionRatio = this.MAX_CORRECTION_FACTOR,
            correctionRatioInverse = 1 / correctionRatio;

        for (i = 0; i < counter.length; i++) {
            counterSum[i % 2] += counter[i];
            codeSum[i % 2] += code[i];
        }
        correction[0] = codeSum[0] / counterSum[0];
        correction[1] = codeSum[1] / counterSum[1];

        correction[0] = Math.max(Math.min(correction[0], correctionRatio), correctionRatioInverse);
        correction[1] = Math.max(Math.min(correction[1], correctionRatio), correctionRatioInverse);
        this.barSpaceRatio = correction;
        for (i = 0; i < counter.length; i++) {
            counter[i] *= this.barSpaceRatio[i % 2];
        }
    }
    return BarcodeReader.prototype._matchPattern.call(this, counter, code);
};

PlesseyReader.prototype._findPattern = function(pattern, offset, isWhite, tryHarder) {
    var counter = [],
        self = this,
        i,
        counterPos = 0,
        bestMatch = {
            error: Number.MAX_VALUE,
            code: -1,
            start: 0,
            end: 0
        },
        error,
        j,
        sum,
        normalized,
        epsilon = self.AVG_CODE_ERROR;

    isWhite = isWhite || false;
    tryHarder = tryHarder || false;

    if (!offset) {
        offset = self._nextSet(self._row);
    }

    for ( i = 0; i < pattern.length * 2; i++) {
        counter[i] = 0;
    }

    for ( i = offset; i < self._row.length; i++) {
        if (self._row[i] ^ isWhite) {
            counter[counterPos]++;
        } else {
            if (counterPos === counter.length - 1) {
                sum = 0;
                for ( j = 0; j < counter.length; j++) {
                    sum += counter[j];
                }
                error = self._matchPattern(counter.filter((v, i) => i % 2 == 1), pattern);
                if (error < epsilon) {
                    bestMatch.error = error;
                    bestMatch.start = i - sum;
                    bestMatch.end = i;
                    return bestMatch;
                }
                if (tryHarder) {
                    for (j = 0; j < counter.length - 2; j++) {
                        counter[j] = counter[j + 2];
                    }
                    counter[counter.length - 2] = 0;
                    counter[counter.length - 1] = 0;
                    counterPos--;
                } else {
                    return null;
                }
            } else {
                counterPos++;
            }
            counter[counterPos] = 1;
            isWhite = !isWhite;
        }
    }
    return null;
};

PlesseyReader.prototype._findStart = function() {
    var self = this,
        leadingWhitespaceStart,
        offset = self._nextSet(self._row),
        startInfo;

    while (!startInfo) {
        startInfo = self._findPattern(self.START_PATTERN, offset, false, true);
        if (!startInfo) {
            return null;
        }

        leadingWhitespaceStart = startInfo.start - (startInfo.end - startInfo.start);
        if (leadingWhitespaceStart >= 0) {
            if (self._matchRange(leadingWhitespaceStart, startInfo.start, 0)) {
                return startInfo;
            }
        }
        offset = startInfo.end;
        startInfo = null;
    }
};

PlesseyReader.prototype._verifyTrailingWhitespace = function(endInfo) {
    var self = this,
        trailingWhitespaceEnd;

    trailingWhitespaceEnd = endInfo.end + ((endInfo.end - endInfo.start) / 2);
    if (trailingWhitespaceEnd < self._row.length) {
        if (self._matchRange(endInfo.end, trailingWhitespaceEnd, 0)) {
            return endInfo;
        }
    }
    return null;
};

PlesseyReader.prototype._findEnd = function() {
    var self = this,
        endInfo,
        tmp;

    self._row.reverse();
    endInfo = self._findPattern(self.STOP_PATTERN);
    self._row.reverse();

    if (endInfo === null) {
        return null;
    }

    // reverse numbers
    tmp = endInfo.start;
    endInfo.start = self._row.length - endInfo.end;
    endInfo.end = self._row.length - tmp;

    return endInfo !== null ? self._verifyTrailingWhitespace(endInfo) : null;
};

PlesseyReader.prototype._decodeCode = function(start, coderange) {
    var counter = [0, 0, 0, 0, 0, 0, 0, 0],
        i,
        self = this,
        offset = start,
        isWhite = !self._row[offset],
        counterPos = 0,
        bestMatch = {
            error: Number.MAX_VALUE,
            code: -1,
            start: start,
            end: start
        },
        code,
        error;

    if (!coderange) {
        coderange = self.CODE_PATTERN.length;
    }

    for ( i = offset; i < self._row.length; i++) {
        if (self._row[i] ^ isWhite) {
            counter[counterPos]++;
        } else {
            if (counterPos === counter.length - 1) {
                for (code = 0; code < coderange; code++) {
                    error = self._matchPattern(counter.filter((v, i) => i % 2 == 0), self.CODE_PATTERN[code]);
                    if (error < bestMatch.error) {
                        bestMatch.code = code;
                        bestMatch.error = error;
                    }
                }
                bestMatch.end = i;
                if (bestMatch.error > self.AVG_CODE_ERROR) {
                    return null;
                }
                return bestMatch;
            } else {
                counterPos++;
            }
            counter[counterPos] = 1;
            isWhite = !isWhite;
        }
    }
    return null;
};

PlesseyReader.prototype._decodePayload = function(result, decodedCodes) {
    var i,
        self = this,
        code,
        next = self._findStart().end,
        final = self._findEnd().start;

    while (next < final) {
        code = self._decodeCode(next);
        if (!code) {
            return null;
        }
        let resultCode = 'X';
        switch(code.code) {
            case 10:
                resultCode = 'A';
                break;
            case 11:
                resultCode = 'B';
                break;
            case 12:
                resultCode = 'C';
                break;
            case 13:
                resultCode = 'D';
                break;
            case 14:
                resultCode = 'E';
                break;
            case 15:
                resultCode = 'F';
                break;
            default:
                resultCode = '' + code.code;
                break;
        }
        result.push(resultCode);
        decodedCodes.push(code);
        next = code.end;
    }

    return code;
};

PlesseyReader.prototype._decode = function() {
    var startInfo,
        endInfo,
        self = this,
        code,
        result = [],
        decodedCodes = [],
        counters;

    startInfo = self._findStart();
    if (!startInfo) {
        return null;
    }
    decodedCodes.push(startInfo);

    endInfo = self._findEnd();
    if (!endInfo) {
        return null;
    }

    code = self._decodePayload(result, decodedCodes);
    if (!code) {
        return null;
    }
    if (result.length < 6) { // Good arbritary number for now
        return null;
    }

    decodedCodes.push(endInfo);
    return {
        code: result.join(""),
        start: startInfo.start,
        end: endInfo.end,
        startInfo: startInfo,
        decodedCodes: decodedCodes
    };
};

PlesseyReader.CONFIG_KEYS = {
    normalizeBarSpaceWidth: {
        'type': 'boolean',
        'default': false,
        'description': 'If true, the reader tries to normalize the' +
        'width-difference between bars and spaces'
    }
};

export default PlesseyReader;
