var extend = require('extend');

// Things that the Player class expects from a format:
// 
// * load() function
// * update() function
// * refresh() function
// * rewind() function
// * position property
// * data property
// * opl property

function ROL(opl, options) {
    options = options || {};

    this.opl = opl;

    this.totalNoteTicks = 0;
    this.currentTimeInTicks = 0;
    this.timeToNextUpdate = 0;

    this.tempoEvents = [];
    this.noteEvents = [];
    this.volumeEvents = [];
    this.instrumentEvents = [];
    this.pitchEvents = [];
    this.currentInstrument = [];

    // Set up array for storing the currently active event index for each
    // event type for each voice.
    this.currentEventIndex = [];
    for (var eventType=0; eventType<4; eventType++) {
        this.currentEventIndex[eventType] = [];
        for (var voice=0; voice<11; voice++) {
            this.currentEventIndex[eventType][voice] = 0;
        }
    }

    // Decode and apply instruments from options.instruments, which will be a .BNK file.
    if (options.instruments) {
        this.decodeInstruments(options.instruments);
    }

    this.init();
}

module.exports = ROL;

extend(ROL.prototype, {

    /**
     * Initialises the ROL player.
     */
    init: function() {
        this.oplWriteInitState();
    },

    decodeInstruments: function(instruments) {
        this.bankData = new DataView(instruments);

        // Header section.
        /* 0x00: */ this.bankMajorVersion = this.bankData.getUint8(0x00, true);
        /* 0x01: */ this.bankMinorVersion = this.bankData.getUint8(0x01, true);
        /* 0x02: Signature. "ADLIB-" */
        /* 0x08: */ this.numInstrumentsUsed = this.bankData.getUint16(0x08, true);
        /* 0x0A: */ this.numInstruments = this.bankData.getUint16(0x0A, true);
        /* 0x0C: */ this.instrumentNamesOffset = this.bankData.getUint32(0x0C, true);
        /* 0x10: */ this.instrumentDataOffset = this.bankData.getUint32(0x10, true);
        /* 0x14: 8 bytes of 0x00 padding. */

        // Offset is 0x1C at the point that we start loading instruments.
        var offset = 0x1C;

        // Instruments keyed by name.
        this.instruments = {};

        // Read in the definitions of every instrument.
        for (var insNum=0; insNum<this.numInstruments; insNum++) {
            var instrument = [];
            var instrumentIndex = this.bankData.getUint16(offset, true);
            offset += 2;
            var usedFlag = this.bankData.getUint8(offset, true);
            offset ++;
            var instrumentOffset = this.instrumentDataOffset + (instrumentIndex * 0x1E);
            var instrumentName = this.loadString(offset, this.bankData);
            offset += 9;

            // Not sure that we need these two.
            var percussive = this.bankData.getUint8(instrumentOffset++);
            var voiceNum = this.bankData.getUint8(instrumentOffset++);
            
            // Modulator operator.
            var keyScalingLevel = this.bankData.getUint8(instrumentOffset++);
            var frequencyMultiplier = this.bankData.getUint8(instrumentOffset++);
            var feedback = this.bankData.getUint8(instrumentOffset++);
            var attack = this.bankData.getUint8(instrumentOffset++);
            var sustain = this.bankData.getUint8(instrumentOffset++);
            var egType = this.bankData.getUint8(instrumentOffset++);
            var decay = this.bankData.getUint8(instrumentOffset++);
            var release = this.bankData.getUint8(instrumentOffset++);
            var totalLevel = this.bankData.getUint8(instrumentOffset++);
            var amplitudeVibrato = this.bankData.getUint8(instrumentOffset++);
            var frequencyVibrato = this.bankData.getUint8(instrumentOffset++);
            var keyScalingRate = this.bankData.getUint8(instrumentOffset++);
            var connection = this.bankData.getUint8(instrumentOffset++);

            instrument[0] = (frequencyMultiplier & 0x0F) | ((keyScalingRate << 4) & 0x10) | ((egType << 5) & 0x20) | ((frequencyVibrato << 6) & 0x40) | ((amplitudeVibrato << 7) & 0x80);
            instrument[2] = (totalLevel & 0x3F) | ((keyScalingLevel << 6) & 0xC0);
            instrument[4] = ((attack << 4) & 0xF0) | (decay & 0x0F);
            instrument[6] = ((sustain << 4) & 0xF0) | (release & 0x0F);
            instrument[10] = ((feedback << 1) & 0x0E) | ((connection ^ 0x01) & 0x01);

            // Carrier operator.
            keyScalingLevel = this.bankData.getUint8(instrumentOffset++);
            frequencyMultiplier = this.bankData.getUint8(instrumentOffset++);
            feedback = this.bankData.getUint8(instrumentOffset++);
            attack = this.bankData.getUint8(instrumentOffset++);
            sustain = this.bankData.getUint8(instrumentOffset++);
            egType = this.bankData.getUint8(instrumentOffset++);
            decay = this.bankData.getUint8(instrumentOffset++);
            release = this.bankData.getUint8(instrumentOffset++);
            totalLevel = this.bankData.getUint8(instrumentOffset++);
            amplitudeVibrato = this.bankData.getUint8(instrumentOffset++);
            frequencyVibrato = this.bankData.getUint8(instrumentOffset++);
            keyScalingRate = this.bankData.getUint8(instrumentOffset++);
            connection = this.bankData.getUint8(instrumentOffset++);

            instrument[1] = (frequencyMultiplier & 0x0F) | ((keyScalingRate << 4) & 0x10) | ((egType << 5) & 0x20) | ((frequencyVibrato << 6) & 0x40) | ((amplitudeVibrato << 7) & 0x80);
            instrument[3] = (totalLevel & 0x3F) | ((keyScalingLevel << 6) & 0xC0);
            instrument[5] = ((attack << 4) & 0xF0) | (decay & 0x0F);
            instrument[7] = ((sustain << 4) & 0xF0) | (release & 0x0F);
            instrument[11] = ((feedback << 1) & 0x0E) | ((connection ^ 0x01) & 0x01);

            // Wave select.
            instrument[8] = this.bankData.getUint8(instrumentOffset++);
            instrument[9] = this.bankData.getUint8(instrumentOffset++);

            // Store instrument data by name.
            this.instruments[instrumentName] = instrument;

            // UINT8	ksl	Key scaling level	0x40 (bits 6-7)	
            // UINT8	multiple	Frequency multiplier	0x20 (bits 0-3)	iMultiple & 0x0F is sent to OPL register [verify this]
            // UINT8	feedback	Feedback [op 0 only, op 1 ignored]	0xC0 (bits 1-3)	
            // UINT8	attack	Attack rate	0x60 (upper four bits)	[verify this]
            // UINT8	sustain	Sustain level	0x80 (upper four bits)	[verify this]
            // UINT8	egType	Envelope gain (nonzero value is on)	0x20 (bit 5)	[verify this]
            // UINT8	decayRate	Decay rate	0x60 (lower four bits)	[verify this]
            // UINT8	releaseRate	Release rate	0x80 (lower four bits)	[verify this]
            // UINT8	totalLevel	Total output level	0x40 (bit 0-5)	[verify this]
            // UINT8	tremolo	Amplitude modulation (Tremolo)	0x20 (bit 7)	[verify this]
            // UINT8	vib	Frequency Vibrato	0x20 (bit 6)	[verify this]
            // UINT8	ksr	Key scaling/envelope rate	0x20 (bit 4)	[verify this]
            // UINT8	con	Connector [op 0 only, op 1 ignored]	0xC0 (bit 0, inverted)	0: OPL bit set to 1
            // other: OPL bit set to 0
        }
    },

    oplWriteReg: function(reg, data) {
        this.opl.write(0, reg, data);
    },

    oplWriteChannel: function(regbase, channel, data1, data2) {
        var reg = regbase + this.op_num[channel];
        this.oplWriteReg(reg, data1);
        this.oplWriteReg(reg + 3, data2);
    },

    oplWriteValue: function(regbase, channel, value) {
        this.oplWriteReg(regbase + channel, value);
    },

    oplConvertVolume: function(data, volume) {
        return 0x3f - (((0x3f - data) * this.volumetable[volume <= 127 ? volume : 127]) >> 7);
    },

    // This is taken from the MUS format class. Not sure if it is 100% valid for ROL.
    oplWriteVolume: function(channel, volumeMultiplier) {
        var instr = this.currentInstrument[channel];
        var volume = Math.round(volumeMultiplier * 0x7F);
        if (instr) {
            this.oplWriteChannel(0x40, channel, ((instr[10] & 1) ?
                this.oplConvertVolume(instr[2] & 0x3F, volume) : instr[2] & 0x3F) | instr[2] & 0xC0,
                this.oplConvertVolume(instr[3] & 0x3F, volume) | instr[3] & 0xC0);
        }
    },

    oplWriteInstrument: function(channel, instr) {
        // Sound Characteristic (REG 0x20-> AM/VIB/EG-TYPE/KSR/MULTIPLE)
        // Level                (REG 0x40-> KSL/TOTAL LEVEL)
        // AttackDecay          (REG 0x60-> ATTACK RATE/DECAY RATE)
        // SustainRelease       (REG 0x80-> SUSTAIN RATE/RELEASE RATE)
        // WaveSelect           (REG 0xE0-> WAVE SELECT)
        // Feedback/Selectivity (REG 0xC0-> FEEDBACK/CONNECTION)
        this.oplWriteChannel(0x20, channel, instr[0], instr[1]);
        this.oplWriteChannel(0x40, channel, instr[2], instr[3]);
        this.oplWriteChannel(0x60, channel, instr[4], instr[5]);
        this.oplWriteChannel(0x80, channel, instr[6], instr[7]);
        this.oplWriteChannel(0xe0, channel, instr[8], instr[9]);
        this.oplWriteValue(0xc0, channel, instr[10] | 0x30);
    },

    oplKeyOff: function(voice) {
        this.oplWriteReg(0xB0 + voice, 0);
    },

    oplPlayNote: function(voice, note, keyon) {
        keyon = (keyon === undefined? true : keyon);
        this.oplKeyOff(voice);
        var blockNum = Math.floor((note-19)/12);
        if (blockNum < 0) blockNum = 0;
        if (blockNum > 7) blockNum = 7;
        var frequency = Math.pow(2, ((note-69)/12)) * 440;
        var fNum = Math.round(frequency * Math.pow(2, (20-blockNum)) / 49716);
        var regNum = 0xA0 + voice;
        this.oplWriteReg(regNum, fNum & 0xff);
        regNum = 0xB0 + voice;
        var tmp = (fNum >> 8) | (blockNum << 2) | (keyon? 0x20 : 0x00);
        this.oplWriteReg(regNum, tmp);
    },

    oplReleaseNote: function(voice, note) {
        this.oplKeyOff(voice);
        if (note > 0) {
          this.oplPlayNote(voice, note, false);
        }
    },

    oplWriteInitState: function() {
        // The underlying OPL3 class supports both OPL3 and OPL2, so we turn off OPL3 as part of the init.
        this.opl.write(1, 0x105, 0x00);	    // disable YMF262/OPL3 mode, so runs in OPL2 mode.
        this.opl.write(1, 0x104, 0x00);	    // disable 4-operator mode
        this.oplWriteReg(0x01, 0x20);	    // enable Waveform Select
        this.oplWriteReg(0x08, 0x40);	    // turn off CSW mode
        this.oplWriteReg(0xbd, 0x00);	    // set vibrato/tremolo depth to low, set melodic mode
    },

    loadTempoEvents: function() {
        // 12      15      char    filler
        // 13      4       float   basic tempo
        // Field 14 indicates the number of times to repeat fields 15 and 16:
        // 14      2       int     number of tempo events
        // 15      2       int     time of events, in ticks
        // 16      4       float   tempo multiplier (0.01 - 10.0)

        // 0xB6: Tempo section start here
        /* 0xB6: 15 byte Tempo section name. Usually "Tempo" */
        this.offset += 15;
        /* 0xC5: */ this.basicTempo = this.data.getFloat32(this.offset, true);
        this.offset += 4;
        /* 0xC9: */ this.numOfTempoEvents = this.data.getUint16(this.offset, true);
        this.offset += 2;

        for (var i=0; i<this.numOfTempoEvents; i++) {
            var timeInTicks = this.data.getUint16(this.offset, true);
            this.offset += 2;
            var tempoMultiplier = this.data.getFloat32(this.offset, true);
            this.offset += 4;

            this.tempoEvents[i] = {
                timeInTicks: timeInTicks,
                tempoMultiplier: tempoMultiplier
            };
        }
    },

    loadString: function(offset, data) {
        var stringStart = offset
        var stringEnd = stringStart;

        // Find the end of the string (null terminated)
        while (data.getUint8(stringEnd++) != 0) ;

        // Convert the byte data between the string start and end in to an ASCII string.
        return String.fromCharCode.apply(null, (new Uint8Array(data.buffer.slice(stringStart, stringEnd - 1))));
    },

    loadNoteEvents: function(voice) {
        this.noteEvents[voice] = [];

        // 15 byte Track name, null terminated (usually "Voix ##", # - voice number from 0)
        this.offset += 15;
        var voiceTotalNoteTicks = this.data.getUint16(this.offset, true);
        this.offset += 2;

        var noteIndex = 0;
        var totalDuration = 0;

        // Repeat the next two fields (19 and 20) while the summation of field 20 is
        // less than the value of field 18:
        while (totalDuration < voiceTotalNoteTicks) {
            // 19      2       int     note number: 0 => silence
            //                         from 12 to 107 => normal note (you must
            //                         subtract 60 to obtain the correct value
            //                         for the sound driver)
            // Note number (0: note off, 12..107: note on)
            // The note value is compatible with MIDI standard (48 is middle-C).
            var noteNumber = this.data.getUint16(this.offset, true);
            this.offset += 2;
            // 20      2       int     note duration, in ticks
            var noteDuration = this.data.getUint16(this.offset, true);
            this.offset += 2;
            this.noteEvents[voice][noteIndex] = {
                timeInTicks: totalDuration,
                note: noteNumber,
                duration: noteDuration
            };
            totalDuration += noteDuration;
            noteIndex++;
        }

        // Note sure if this is the best way to work out the end of the song.
        if (voiceTotalNoteTicks > this.totalNoteTicks) {
            this.totalNoteTicks = voiceTotalNoteTicks;
        }
    },

    loadInstrumentEvents: function(voice) {
        // AKA. The Timbre track.
        this.instrumentEvents[voice] = [];

        // 15 byte Track name, null terminated (usually "Timbre ##", # - voice number from 0)
        this.offset += 15;
        this.numOfInstrumentEvents = this.data.getUint16(this.offset, true);
        this.offset += 2;

        // Field 22 indicates the number of times to repeat fields 23 to 26:
        // 22      2       int     number of instrument events
        for (var i=0; i<this.numOfInstrumentEvents; i++) {
            var timeInTicks = this.data.getUint16(this.offset, true);
            this.offset += 2;
            // 9 bytes, Instrument name, null terminated
            // Instrument name is a reference to INSTNAME.INS file, or an instrument name inside STANDARD.BNK file.
            var instrumentName = this.loadString(this.offset, this.data);
            this.offset += 9;
            // 1 byte, padding, set to zero.
            this.offset++;
            // 2 bytes, unknown/unused value. Sometimes equal to instrument index
            this.offset += 2;

            this.instrumentEvents[voice][i] = {
                timeInTicks: timeInTicks,
                instrumentName: instrumentName
            };
        }
    },

    loadVolumeEvents: function(voice) {
        this.volumeEvents[voice] = [];

        // 15 byte Track name, null terminated (usually "Volume ##", # - voice number from 0)
        this.offset += 15;
        this.numOfVolumeEvents = this.data.getUint16(this.offset, true);
        this.offset += 2;

        // Field 28 indicates the number of times to repeat fields 29 and 30:
        // 28      2       int     number of volume events
        for (var i=0; i<this.numOfVolumeEvents; i++) {
            var timeInTicks = this.data.getUint16(this.offset, true);
            this.offset += 2;
            var volumeMultiplier = this.data.getFloat32(this.offset, true);
            this.offset += 4;

            this.volumeEvents[voice][i] = {
                timeInTicks: timeInTicks,
                volumeMultiplier: volumeMultiplier
            };
        }
    },

    loadPitchEvents: function(voice) {
        this.pitchEvents[voice] = [];

        // 15 byte Track name, null terminated (usually "Pitch ##", # - voice number from 0)
        this.offset += 15;
        this.numOfPitchEvents = this.data.getUint16(this.offset, true);
        this.offset += 2;

        // Field 32 indicates the number of times to repeat fields 33 and 34:
        // 32      2       int     number of pitch events
        for (var i=0; i<this.numOfPitchEvents; i++) {
            var timeInTicks = this.data.getUint16(this.offset, true);
            this.offset += 2;
            // 34      4       float   pitch variation (0.0 - 2.0, nominal is 1.0)
            // Single	pitch	Pitch variation (in range 0.0 - 2.0)
            // These events works the same as Pitch Bend events. Nominal pitch value is 1.0.
            var pitchVariation = this.data.getFloat32(this.offset, true);
            this.offset += 4;

            this.pitchEvents[voice][i] = {
                timeInTicks: timeInTicks,
                pitchVariation: pitchVariation
            };
        }
    },

    load: function(buffer) {
        this.data = new DataView(buffer.buffer || buffer);

        // Header section.
        /* 0x00: */ this.majorVersion = this.data.getUint16(0, true);
        /* 0x02: */ this.minorVersion = this.data.getUint16(2, true);
        /* 0x04: ROL file type signature of 40 bytes at this point. We ignore. Usually "\roll\default" */
        /* 0x2C: */ this.ticksPerBeat = this.data.getUint16(44, true);
        /* 0x2E: */ this.beatsPerMeasure = this.data.getUint16(46, true);
        /* 0x30: */ this.scaleYAxis = this.data.getUint16(48, true);
        /* 0x32: */ this.scaleXAxis = this.data.getUint16(50, true);
        /* 0x34: 1 byte gap reserved for future use. Set to zero. */
        /* 0x35: */ this.musicMode = this.data.getUint8(53, true);  // 0 = percussive, 1 = melodic
        /* 0x36: Counter values for each track at this point. 90 bytes, being 45 * 2 (each is a UINT16LE) */
        /* 0x90: Filler/Padding of 38 bytes at this point, all set to zero. */

        // Offset is 0xB6 at the point that we start loading events.
        this.offset = 0xB6;

        // There is only one set of tempo events that applies to all voices.
        this.loadTempoEvents();

        // All other event types are repeats 11 times, i.e. once for each voice.
        for (var voice=0; voice<11; voice++) {
            this.loadNoteEvents(voice);
            this.loadInstrumentEvents(voice);
            this.loadVolumeEvents(voice);
            this.loadPitchEvents(voice);
        }

        this.position = 0;

        this.channels = [];

        for (var i = 0; i < this.OPL2CHANNELS; i++){
            this.channels[i] = {};
        }

    },

    // Updates the OPL2 chip with more settings from the song data.
    // Returns true if there is more of the song to play; otherwise false.
    update: function() {
        if (this.currentTimeInTicks >= this.totalNoteTicks) {
            return false;
        }

        // Last update was timeToNextUpdate ticks ago.
        this.currentTimeInTicks += this.timeToNextUpdate;

        // Set timeToNextUpdate to full length, then whilst scanning the events, this
        // number will be reduced until we have the true/actual timeToNextUpdate value.
        this.timeToNextUpdate = this.totalNoteTicks;

        // Update the 11 voices
        // Voice 5 (index 4) jazzguit first note sounds really distorted.
        // Voice 6 (index 5) strings: volume not low enough? piano: only one note, but volume changes are causing note to be played multiple times.
        var voice = 5;
        for (var voice=0; voice<11; voice++) {

            // Update the instrument events.
            var nextInstrumentIndex = this.currentEventIndex[2][voice];
            var nextInstrument = this.instrumentEvents[voice][nextInstrumentIndex];

            if (nextInstrument) {
                // Check if we need to change instrument for this voice.
                if (nextInstrument.timeInTicks <= this.currentTimeInTicks) {
                    // The last instrument has ended, so start the next note.
                    var instrumentName = nextInstrument.instrumentName.toUpperCase();
                    var instrumentDefinition = this.instruments[instrumentName];
                    if (instrumentDefinition) {
                        this.oplWriteInstrument(voice, instrumentDefinition);
                        this.currentInstrument[voice] = instrumentDefinition;
                    }

                    // Set up event index for the next instrument.
                    this.currentEventIndex[2][voice] = ++nextInstrumentIndex;
                    nextInstrument = this.instrumentEvents[voice][nextInstrumentIndex];
                }

                // Check if the next instrument's start tick is lower than the current timeToNextUpdate.
                if (nextInstrument && (nextInstrument.timeInTicks > this.currentTimeInTicks)) {
                    var timeToInstrument = nextInstrument.timeInTicks - this.currentTimeInTicks;
                    if (timeToInstrument < this.timeToNextUpdate) {
                        this.timeToNextUpdate = timeToInstrument;
                    }
                }
            }

            // Update the volume events.
            var nextVolumeIndex = this.currentEventIndex[1][voice];
            var nextVolume = this.volumeEvents[voice][nextVolumeIndex];

            if (nextVolume) {
                // Check if we need to change volume for this voice.
                if (nextVolume.timeInTicks <= this.currentTimeInTicks) {
                    // The last volume has ended, so start the next note.
                    this.oplWriteVolume(voice, nextVolume.volumeMultiplier);

                    // Set up event index for the next volume.
                    this.currentEventIndex[1][voice] = ++nextVolumeIndex;
                    nextVolume = this.volumeEvents[voice][nextVolumeIndex];
                }

                // Check if the next volume's start tick is lower than the current timeToNextUpdate.
                if (nextVolume && (nextVolume.timeInTicks > this.currentTimeInTicks)) {
                    var timeToVolume = nextVolume.timeInTicks - this.currentTimeInTicks;
                    if (timeToVolume < this.timeToNextUpdate) {
                        this.timeToNextUpdate = timeToVolume;
                    }
                }
            }

            // Update the Notes.
            var nextNoteIndex = this.currentEventIndex[0][voice];
            var nextNote = this.noteEvents[voice][nextNoteIndex];
            var currentNote = (nextNoteIndex > 0? this.noteEvents[voice][nextNoteIndex-1] : nextNote);

            if (nextNote) {
                // Check if we need to play a new note for this voice.
                if (nextNote.timeInTicks <= this.currentTimeInTicks) {
                    // The last note has ended, so play the next note.
                    if (nextNote.note > 0) {
                        this.oplPlayNote(voice, nextNote.note);
                    } else {
                        // We only play a note if it is greater than 0. Note 0 means OFF, i.e. release last note.
                        this.oplReleaseNote(voice, currentNote.note);
                    }

                    // Set up event index for the next note.
                    this.currentEventIndex[0][voice] = ++nextNoteIndex;
                    nextNote = this.noteEvents[voice][nextNoteIndex];
                }

                // Check if the next note's start tick is lower than the current timeToNextUpdate.
                if (nextNote && (nextNote.timeInTicks > this.currentTimeInTicks)) {
                    var timeToNote = nextNote.timeInTicks - this.currentTimeInTicks;
                    if (timeToNote < this.timeToNextUpdate) {
                        this.timeToNextUpdate = timeToNote;
                    }
                }
            }

            // TODO: Update the pitch events.

        }

        // TODO: Apply the tempo events. We're reading them from the ROL file but doing nothing with them.

        this.position = ((this.currentTimeInTicks / this.totalNoteTicks) * this.data.byteLength);

        return (this.timeToNextUpdate < this.totalNoteTicks);
    },

    // Returns the time in seconds to delay, or number of seconds to generate samples for before calling update again.
    // e.g. For IMF, the delay is in cycles, and there are 700 cycles in a second. So the IMF refresh function returns delay / 700.
    // This is the number of seconds that the current OPL2 chip settings are valid to generate sound for.
    refresh: function() {
        // timeToNextUpdate is in ticks. We need to work out what fraction of a second this is.
        return this.timeToNextUpdate / ((this.basicTempo / 60) * this.ticksPerBeat);
    },

    rewind: function() {

    },

    op_num: [0x00, 0x01, 0x02, 0x08, 0x09, 0x0A, 0x10, 0x11, 0x12],

    volumetable: [
        0, 1, 3, 5, 6, 8, 10, 11,
        13, 14, 16, 17, 19, 20, 22, 23,
        25, 26, 27, 29, 30, 32, 33, 34,
        36, 37, 39, 41, 43, 45, 47, 49,
        50, 52, 54, 55, 57, 59, 60, 61,
        63, 64, 66, 67, 68, 69, 71, 72,
        73, 74, 75, 76, 77, 79, 80, 81,
        82, 83, 84, 84, 85, 86, 87, 88,
        89, 90, 91, 92, 92, 93, 94, 95,
        96, 96, 97, 98, 99, 99, 100, 101,
        101, 102, 103, 103, 104, 105, 105, 106,
        107, 107, 108, 109, 109, 110, 110, 111,
        112, 112, 113, 113, 114, 114, 115, 115,
        116, 117, 117, 118, 118, 119, 119, 120,
        120, 121, 121, 122, 122, 123, 123, 123,
        124, 124, 125, 125, 126, 126, 127, 127
    ],
    
    blockData: [
        [ 48.50336838, 21.09131869 ],
        [ 97.00673676, 10.54565935 ],
        [ 194.0134735, 5.272829673 ],
        [ 388.026947,  2.636414836 ],
        [ 776.053894,  1.318207418 ],
        [ 1552.107788, 0.659103709 ],
        [ 3104.215576, 0.329551854 ],
        [ 6208.431152, 0.164775927 ]
    ],
    
    OPL2CHANNELS: 9
});